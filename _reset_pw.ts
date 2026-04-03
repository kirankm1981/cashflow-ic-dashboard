import bcrypt from "bcrypt";
import { pool } from "./server/db";
async function main() {
  const h = await bcrypt.hash("Admin@1234", 12);
  await pool.query("UPDATE users SET password = $1 WHERE username = $2", [h, "admin"]);
  console.log("done");
  await pool.end();
}
main();
