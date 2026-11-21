import { createServer } from "node:http";
import { handleAsNodeRequest } from "cloudflare:node";
import express from "express";

const app = express();
app.post(
  "/",
  express.raw({ type: "application/octet-stream", limit: 32, inflate: false }),
  (req, res) => {
    res
      .cookie("__Host-bridge-probe", "ok", {
        httpOnly: true,
        secure: true,
        sameSite: "lax",
        path: "/",
      })
      .cookie("second-probe", "ok")
      .json({ bytes: [...req.body] });
  },
);
app.get("/", (req, res) => res.json({ cookie: req.get("Cookie") }));

const port = 3000;
createServer(app).listen(port);
export default {
  fetch(request) {
    return handleAsNodeRequest(port, request);
  },
};
