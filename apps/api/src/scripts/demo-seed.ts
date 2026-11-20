import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import bcrypt from "bcrypt";
import { pool } from "../config/database.js";
import { env } from "../config/env.js";
import { generateTemporaryPassword } from "../auth/security.js";
import { recordAudit } from "../audit/audit.js";

const args = process.argv.slice(2);
const countAt = args.indexOf("--count");
const count = countAt < 0 ? 500 : Number(args[countAt + 1]);
if (
  !args.includes("--confirm-demo") ||
  !Number.isInteger(count) ||
  count < 1 ||
  count > 500
) {
  console.error(
    "Usage: npm run db:seed-demo -- --confirm-demo [--count 500]. Adds fictional DEMO-0001… records only; never resets existing data.",
  );
  process.exitCode = 1;
  await pool.end();
} else {
  const first = [
    "Ayan",
    "Nadia",
    "Rafi",
    "Maliha",
    "Sajid",
    "Nusrat",
    "Imran",
    "Farhana",
    "Tanvir",
    "Samira",
  ];
  const last = [
    "Demo Ahmed",
    "Demo Rahman",
    "Demo Islam",
    "Demo Karim",
    "Demo Hasan",
  ];
  const namesBn = [
    "আয়ান",
    "নাদিয়া",
    "রাফি",
    "মালিহা",
    "সাজিদ",
    "নুসরাত",
    "ইমরান",
    "ফারহানা",
    "তানভীর",
    "সামিরা",
  ];
  const client = await pool.connect();
  let created = 0;
  const credentials: string[] = ["employeeId,temporaryPassword"];
  try {
    const departments = (
      await client.query<{ id: string }>(
        "SELECT id FROM departments WHERE is_active=TRUE ORDER BY name_en",
      )
    ).rows;
    const leaveType = (
      await client.query<{ id: string }>(
        "SELECT id FROM leave_types WHERE code='CASUAL' AND is_active=TRUE",
      )
    ).rows[0];
    if (!departments.length || !leaveType)
      throw new Error("Run db:setup and db:seed first.");
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(734613)");
    for (let i = 1; i <= count; i++) {
      const code = `DEMO-${String(i).padStart(4, "0")}`;
      if (
        (
          await client.query(
            "SELECT id FROM employees WHERE official_employee_id=$1",
            [code],
          )
        ).rowCount
      )
        continue;
      const password = generateTemporaryPassword(),
        hash = await bcrypt.hash(password, env.BCRYPT_COST);
      const employee = (
        await client.query<{ id: string }>(
          `INSERT INTO employees(official_employee_id,department_id,first_name_en,last_name_en,full_name_bn,employment_status,gender,blood_group,designation,joining_date,email,phone,present_address,permanent_address,date_of_birth,father_name,mother_name,religion,marital_status) VALUES($1,$2,$3,$4,$5,'ACTIVE',$6,$7,$8,$9,$10,$11,$12,$12,$13,$14,$15,$16,$17) RETURNING id`,
          [
            code,
            departments[(i - 1) % departments.length]!.id,
            first[(i - 1) % first.length],
            last[(i - 1) % last.length],
            `${namesBn[(i - 1) % namesBn.length]} ডেমো ${i}`,
            i % 2 ? "MALE" : "FEMALE",
            ["A+", "B+", "O+", "AB+"][i % 4],
            ["Demo Officer", "Demo Assistant", "Demo Engineer"][i % 3],
            `20${String(15 + (i % 10))}-01-10`,
            `demo${i}@example.invalid`,
            `000000${String(i).padStart(5, "0")}`,
            "Fictional Demo Campus, Sample Road",
            `19${String(75 + (i % 24))}-06-15`,
            "Demo Father",
            "Demo Mother",
            "Not specified",
            i % 3 ? "SINGLE" : "MARRIED",
          ],
        )
      ).rows[0]!;
      const user = (
        await client.query<{ id: string }>(
          "INSERT INTO users(employee_id,password_hash,role,account_status,must_change_password) VALUES($1,$2,'EMPLOYEE','ACTIVE',TRUE) RETURNING id",
          [employee.id, hash],
        )
      ).rows[0]!;
      await client.query(
        "INSERT INTO academic_qualifications(employee_id,institution,degree,subject,passing_year,result) VALUES($1,'Fictional Demo University','Bachelor degree','Demo studies',2015,'Demo grade')",
        [employee.id],
      );
      await client.query(
        "INSERT INTO training_records(employee_id,title,provider,start_date,end_date,remarks) VALUES($1,'Demo workplace orientation','Fictional Training Centre','2025-01-05','2025-01-07','Synthetic record for demonstration')",
        [employee.id],
      );
      await client.query(
        "INSERT INTO service_history(employee_id,organization,designation,start_date,end_date) VALUES($1,'Fictional Demo Office','Demo Assistant','2020-01-01','2022-12-31')",
        [employee.id],
      );
      await client.query(
        "INSERT INTO posting_history(employee_id,department_id,office_name,designation,start_date,order_reference) VALUES($1,$2,'Fictional Demo Campus','Demo Officer','2023-01-01','DEMO-ORDER')",
        [employee.id, departments[(i - 1) % departments.length]!.id],
      );
      await client.query(
        "INSERT INTO professional_memberships(employee_id,organization,membership_number,membership_type,start_date) VALUES($1,'Fictional Demo Society',$2,'Demo member','2024-01-01')",
        [employee.id, code],
      );
      await client.query(
        "INSERT INTO publications(employee_id,title,publication_name,publication_date,reference_url) VALUES($1,'Fictional demonstration paper','Demo Journal','2025-02-01','https://example.invalid/demo')",
        [employee.id],
      );
      if (i % 3 === 0)
        await client.query(
          "INSERT INTO employee_spouse(employee_id,spouse_name,spouse_occupation) VALUES($1,'Fictional Demo Spouse','Demo occupation')",
          [employee.id],
        );
      if (i % 5 === 0)
        await client.query(
          "INSERT INTO change_requests(employee_id,submitted_by_user_id,field_key,target_record_type,operation,old_value_snapshot,proposed_value) VALUES($1,$2,'designation','PROFILE','UPDATE',$3::jsonb,'\"Demo Senior Officer\"'::jsonb)",
          [
            employee.id,
            user.id,
            JSON.stringify(
              ["Demo Officer", "Demo Assistant", "Demo Engineer"][i % 3],
            ),
          ],
        );
      if (i % 4 === 0) {
        const days = await client.query<{ days: number }>(
          "SELECT 3-COUNT(*)::int AS days FROM public_holidays WHERE holiday_date BETWEEN CURRENT_DATE AND CURRENT_DATE+2",
        );
        if (days.rows[0]!.days > 0) {
          const leave = (
            await client.query<{ id: string }>(
              "INSERT INTO leave_records(employee_id,leave_type_id,start_date,end_date,day_count,remarks) VALUES($1,$2,CURRENT_DATE,CURRENT_DATE+2,$3,'Fictional demo leave') RETURNING id",
              [employee.id, leaveType.id, days.rows[0]!.days],
            )
          ).rows[0]!;
          await client.query(
            "INSERT INTO leave_holiday_snapshots(leave_record_id,holiday_date) SELECT $1,holiday_date FROM public_holidays WHERE holiday_date BETWEEN CURRENT_DATE AND CURRENT_DATE+2",
            [leave.id],
          );
        }
      }
      await recordAudit(client, {
        actorUserId: null,
        actorRole: "SYSTEM",
        action: "DEMO_EMPLOYEE_SEEDED",
        entityType: "employee",
        entityId: employee.id,
      });
      credentials.push(`${code},${password}`);
      created++;
    }
    // Credentials must be saved successfully before committing accounts.
    const output = resolve(`demo-credentials-${Date.now()}.csv`);
    if (created)
      await writeFile(output, credentials.join("\n") + "\n", {
        mode: 0o600,
        flag: "wx",
      });
    await client.query("COMMIT");
    console.log(
      `Created ${created} fictional employee accounts. Existing IDs were skipped.`,
    );
    if (created)
      console.log(
        `One-time credentials: ${output}. Keep private, pass only the chosen demo account credentials to the presenter, and delete the file after use. Each account requires a new password at first login.`,
      );
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}
