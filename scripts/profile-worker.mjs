import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import WebSocket from "ws";
import sharp from "sharp";

const exec = promisify(execFile);
const scratch = await mkdtemp(join(tmpdir(), "ems-worker-profile-"));
process.env.WRANGLER_LOG_PATH ??= join(scratch, "wrangler.log");
process.env.WRANGLER_SEND_METRICS = "false";
process.env.CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV = "false";
const children = [];
const extraFixture = process.argv.includes("--larger-fixture");
const origin = "http://127.0.0.1:8792";
const wrangler = "./node_modules/.bin/wrangler";
const config = ["--config", "apps/api/worker/wrangler.jsonc"];
const storage = ["--local", "--persist-to", join(scratch, "d1")];
let address = 0;
const uniqueAddress = () => {
  address++;
  return "198.18." + Math.floor(address / 254) + "." + (1 + (address % 254));
};
const targets = async (url) =>
  (
    await waitFor(async () => {
      const response = await fetch(url, { signal: AbortSignal.timeout(800) });
      return response.ok && response.json();
    })
  ).find((item) => item.webSocketDebuggerUrl);

function start(binary, args) {
  const child = spawn(binary, args, { stdio: ["ignore", "pipe", "pipe"] });
  const log = [];
  child.stdout.on("data", (chunk) => log.push(String(chunk)));
  child.stderr.on("data", (chunk) => log.push(String(chunk)));
  children.push({ child, log });
  return child;
}

async function waitFor(check) {
  for (let i = 0; i < 100; i++) {
    try {
      const value = await check();
      if (value) return value;
    } catch {}
    await delay(90);
  }
  throw new Error("Timed out waiting for local test state");
}

async function debuggerSession(endpoint) {
  const endpointURL = new URL(endpoint);
  endpointURL.hostname = "127.0.0.1";
  const websocket = new WebSocket(endpointURL, { handshakeTimeout: 5000 });
  await new Promise((resolve, reject) => {
    websocket.once("open", resolve);
    websocket.once("error", reject);
  });
  let sequence = 0;
  const pending = new Map();
  websocket.on("message", (chunk) => {
    const data = JSON.parse(chunk);
    const call = pending.get(data.id);
    if (!call) return;
    pending.delete(data.id);
    if (data.error) call.reject(new Error(data.error.message));
    else call.resolve(data.result);
  });
  return {
    call(method, params = {}) {
      const id = ++sequence;
      const response = new Promise((resolve, reject) =>
        pending.set(id, { resolve, reject }),
      );
      websocket.send(JSON.stringify({ id, method, params }));
      return response;
    },
    close: () => websocket.close(),
  };
}

async function api(path, { method = "GET", cookie, csrf, body, ip } = {}) {
  const headers = {};
  if (ip) headers["CF-Connecting-IP"] = ip;
  if (cookie) headers.Cookie = cookie;
  if (csrf) headers["X-CSRF-Token"] = csrf;
  if (method !== "GET") headers.Origin = origin;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const response = await fetch(origin + "/api/v1" + path, {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok)
    assert.fail(
      path + " returned " + response.status + ": " + (await response.text()),
    );
  const data = await response.json();
  return {
    data,
    cookie: response.headers.getSetCookie()[0]?.split(";")[0],
    csrf: data.csrfToken,
  };
}

const newPersona = (persona, creds = {}) =>
  api("/demo/session", {
    ...creds,
    method: "POST",
    ip: uniqueAddress(),
    body: { persona },
  });

// Aggregate process CPU includes local workerd runtime, V8, and simulated D1.
function cpuTimeSeconds(text) {
  return text.split(":").reduce((total, part) => total * 60 + Number(part), 0);
}

async function cpuTree(rootPid) {
  const { stdout } = await exec("/bin/ps", ["-axo", "pid=,ppid=,time=,comm="]);
  const table = stdout
    .trim()
    .split("\n")
    .flatMap((line) => {
      const found = line.trim().match(/^(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/);
      return found
        ? [
            {
              pid: +found[1],
              parent: +found[2],
              seconds: cpuTimeSeconds(found[3]),
              name: found[4],
            },
          ]
        : [];
    });
  const descendants = new Set([rootPid]);
  let prior;
  do {
    prior = descendants.size;
    for (const proc of table)
      if (descendants.has(proc.parent)) descendants.add(proc.pid);
  } while (prior !== descendants.size);
  return table.filter(
    (proc) => descendants.has(proc.pid) && /(^|\/)workerd$/.test(proc.name),
  );
}

try {
  const { stdout } = await exec(wrangler, [
    "d1",
    "migrations",
    "apply",
    "DB",
    ...config,
    ...storage,
  ]);
  console.log(
    stdout
      .split("\n")
      .filter((line) => /000[123]_/.test(line))
      .slice(-3)
      .join("\n"),
  );
  if (extraFixture) {
    await exec(wrangler, [
      "d1",
      "execute",
      "DB",
      ...config,
      ...storage,
      "--file",
      "scripts/worker-capacity-fixture.sql",
    ]);
  }
  const child = start(wrangler, [
    "dev",
    ...config,
    ...storage,
    "--port",
    "8792",
    "--inspector-port",
    "9232",
  ]);
  await waitFor(
    async () =>
      (
        await fetch(origin + "/api/v1/ready", {
          signal: AbortSignal.timeout(800),
        })
      ).ok,
  );
  const target = await targets("http://127.0.0.1:9232/json/list");
  const profiler = await debuggerSession(target.webSocketDebuggerUrl);
  const fid = (n) => "00000000-0000-4000-8000-" + String(n).padStart(12, "0");
  const send = (creds, path, body, method = "POST") =>
    api(path, { ...creds, method, ip: uniqueAddress(), body });
  const person = (n) => ({
    officialEmployeeId: "BENCH-" + n,
    departmentId: fid(101),
    firstNameEn: "Demo " + n,
    gender: "FEMALE",
    bloodGroup: "B+",
  });
  const opt = {
    leaveTypeId: fid(501),
    startDate: "2030-01-06",
    endDate: "2030-01-08",
  };
  const leaveCrets = await newPersona("root");
  const admin = await newPersona("root");
  const image = await newPersona("employee");
  const png = await sharp(
    Buffer.from(
      Array.from({ length: 512 * 512 * 3 }, (_, i) => {
        let h = Math.imul(i + 7, 0x45d9f3b);
        h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
        return h ^ (h >>> 16);
      }),
    ),
    { raw: { width: 512, height: 512, channels: 3 } },
  )
    .jpeg({ quality: 85 })
    .toBuffer();
  assert.ok(png.length < 192 * 1024);
  console.log("Profile photo payload:", png.length, "bytes");
  const eligibility = await newPersona("root");
  const { data: leave } = await send(leaveCrets, "/admin/leaves", {
    ...opt,
    employeeId: fid(205),
  });
  const entry = (num) => () => newPersona(num % 2 === 0 ? "employee" : "root");
  let switched = await newPersona("root");
  const many = (count, fn) =>
    Array.from({ length: count }, (_, i) => () => fn(i));
  const measure = async (name, ops) => {
    const active = [],
      elapsed = [],
      groups = {};
    let failures = 0;
    const startCpu = await cpuTree(child.pid);
    assert.ok(startCpu.length, "No workerd processes found by ps");
    for (const operation of ops) {
      if (process.env.EMS_PROFILE === "1")
        await profiler.call("Profiler.start");
      const start = performance.now();
      try {
        await operation();
      } catch (error) {
        failures++;
        process.exitCode = 1;
        console.error(name, error.message.slice(0, 300));
      }
      elapsed.push(performance.now() - start);
      if (process.env.EMS_PROFILE === "1") {
        const { profile } = await profiler.call("Profiler.stop");
        const nodes = new Map(
          profile.nodes.map((node) => [node.id, node.callFrame]),
        );
        let cpu = 0;
        for (let j = 0; j < profile.samples.length; j++) {
          const frame = nodes.get(profile.samples[j]);
          if (
            !frame ||
            ["(idle)", "(root)", "(program)"].includes(frame.functionName)
          )
            continue;
          const ms = profile.timeDeltas[j] / 1000;
          cpu += ms;
          const key =
            (frame.functionName || "(anonymous)") + ":" + frame.lineNumber;
          groups[key] = (groups[key] ?? 0) + ms;
        }
        active.push(cpu);
      }
    }
    const endCpu = new Map(
      (await cpuTree(child.pid)).map((proc) => [proc.pid, proc.seconds]),
    );
    assert.ok(
      startCpu.every(({ pid }) => endCpu.has(pid)),
      "workerd restarted during the sample",
    );
    const stats = (arr) =>
      arr.length
        ? {
            mean: +(arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(2),
            p95: +arr
              .sort((a, b) => a - b)
              [Math.ceil(arr.length * 0.95) - 1].toFixed(2),
            max: +arr.at(-1).toFixed(2),
          }
        : null;
    console.log(
      JSON.stringify({
        name,
        count: ops.length,
        failures,
        windowCpuMean: +(
          (1000 *
            startCpu.reduce(
              (sum, proc) => sum + endCpu.get(proc.pid) - proc.seconds,
              0,
            )) /
          ops.length
        ).toFixed(2),
        active: stats(active),
        elapsed: stats(elapsed),
        hot: Object.entries(groups)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 9)
          .map(([key, ms]) => [key, +ms.toFixed(2)]),
      }),
    );
  };
  try {
    operations: {
      await profiler.call("Profiler.enable");
      await profiler.call("Profiler.setSamplingInterval", { interval: 100 });
      for (let i = 0; i < 4; i++) await newPersona("employee");
      await measure(
        "workspace entry",
        Array.from({ length: 22 }, (_, i) => entry(i)),
      );
      if (extraFixture) {
        await measure(
          "root dashboard",
          many(24, () => api("/overview/stats", admin)),
        );
        break operations;
      }
      await measure(
        "persona switching",
        many(20, async (i) => {
          switched = await newPersona(i % 2 ? "root" : "employee", switched);
        }),
      );
      await measure(
        "root dashboard",
        many(24, () => api("/overview/stats", admin)),
      );
      let resetter = await newPersona("root");
      await measure(
        "workspace reset",
        many(12, async () => {
          resetter = await send(resetter, "/demo/reset", undefined);
        }),
      );
      await measure(
        "employee create",
        many(18, (i) => send(admin, "/admin/employees", person(i))),
      );
      await measure(
        "employee edit",
        many(18, (i) =>
          send(
            admin,
            "/admin/employees/" + fid(205),
            { designation: "Revision " + i },
            "PATCH",
          ),
        ),
      );
      await measure(
        "leave correction",
        many(18, (i) =>
          send(
            leaveCrets,
            "/admin/leaves/" + leave.id,
            { ...opt, remarks: "demo " + i, reason: "Updated example" },
            "PATCH",
          ),
        ),
      );

      const profiles = await Promise.all(
        Array.from({ length: 8 }, () => newPersona("root")),
      );
      await measure(
        "profile approval",
        profiles.map(
          (c) => () =>
            send(c, "/admin/change-requests/" + fid(801) + "/decision", {
              action: "APPROVE",
            }),
        ),
      );
      const leaves = [];
      for (let i = 0; i < 8; i++) {
        const employee = await newPersona("employee");
        const {
          data: { id },
        } = await send(employee, "/me/leave-requests", opt);
        leaves.push({ id, creds: await newPersona("root", employee) });
      }
      await measure(
        "leave approval",
        leaves.map(
          ({ id, creds }) =>
            () =>
              send(creds, "/admin/leave-requests/" + id + "/decision", {
                action: "APPROVE",
              }),
        ),
      );

      await measure(
        "512 px image upload",
        many(18, async () => {
          const res = await fetch(origin + "/api/v1/me/profile-image", {
            method: "POST",
            headers: {
              Origin: origin,
              Cookie: image.cookie,
              "X-CSRF-Token": image.csrf,
              "CF-Connecting-IP": uniqueAddress(),
              "Content-Type": "image/jpeg",
            },
            body: png,
          });
          assert.equal(
            res.status,
            200,
            res.status === 200 ? "" : await res.text(),
          );
          await res.json();
        }),
      );

      const imports = [];
      for (let i = 0; i < 8; i++) imports.push(await newPersona("root"));
      const rows = Array.from({ length: 12 }, (_, i) => ({
        rowType: "PROFILE",
        action: "CREATE",
        ...person(100 + i),
        presentAddress: "Demo address, ".repeat(65),
        permanentAddress: "Fictional district, ".repeat(43),
        designation: "Portfolio operations specialist",
      }));
      const previews = [];
      await measure(
        "12-row import preview (~23 KiB)",
        imports.map((c) => async () => {
          const { data } = await send(c, "/admin/data/files/preview", { rows });
          assert.ok(data.results.every((r) => r.valid));
          previews.push({ c, id: data.previewId });
        }),
      );
      await measure(
        "12-row import commit (~23 KiB)",
        previews.map(
          ({ c, id }) =>
            () =>
              send(c, "/admin/data/files/commit", {
                previewId: id,
                selected: rows.map((_, i) => i + 2),
              }),
        ),
      );

      for (let i = 0; i < 4; i++) {
        const batch = rows.map((r, j) => ({
          ...r,
          officialEmployeeId: "BULK-" + (i * 12 + j),
        }));
        const { data } = await send(eligibility, "/admin/data/files/preview", {
          rows: batch,
        });
        await send(eligibility, "/admin/data/files/commit", {
          previewId: data.previewId,
          selected: batch.map((_, index) => index + 2),
        });
      }
      await measure(
        "58-employee masked XLSX export preparation",
        many(24, () =>
          send(eligibility, "/admin/data/pds", { format: "xlsx" }),
        ),
      );
      await measure(
        "58-employee directory",
        many(36, () => api("/admin/employees?pageSize=60", eligibility)),
      );
    }
  } finally {
    profiler.close();
  }
} catch (error) {
  for (const { log } of children) console.error(log.join("").slice(-2000));
  throw error;
} finally {
  for (const { child } of children)
    if (child.exitCode === null && child.signalCode === null)
      child.kill("SIGTERM");
  await Promise.all(
    children.map(({ child }) =>
      child.exitCode !== null || child.signalCode !== null
        ? Promise.resolve()
        : new Promise((resolve) => child.once("exit", resolve)),
    ),
  );
  await rm(scratch, { recursive: true, force: true });
}
