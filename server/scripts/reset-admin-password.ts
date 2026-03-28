import pg from "pg";
import bcrypt from "bcryptjs";

const DEFAULT_USERNAME = "admin";

async function resetAdminPassword() {
  let username: string;
  let newPassword: string | undefined;

  if (process.argv.length === 3) {
    username = DEFAULT_USERNAME;
    newPassword = process.argv[2];
  } else {
    username = process.argv[2] || DEFAULT_USERNAME;
    newPassword = process.argv[3];
  }

  if (!newPassword) {
    console.error("Usage: npx tsx server/scripts/reset-admin-password.ts [username] <new-password>");
    console.error("  username defaults to 'admin' if not provided");
    console.error("");
    console.error("Examples:");
    console.error("  npx tsx server/scripts/reset-admin-password.ts NewSecurePass123");
    console.error("  npx tsx server/scripts/reset-admin-password.ts admin NewSecurePass123");
    console.error("  npx tsx server/scripts/reset-admin-password.ts johndoe NewSecurePass123");
    process.exit(1);
  }

  if (newPassword.length < 6) {
    console.error("Error: Password must be at least 6 characters long.");
    process.exit(1);
  }

  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
  });

  try {
    const userResult = await pool.query(
      "SELECT id, username, display_name, role FROM users WHERE username = $1",
      [username]
    );

    if (userResult.rows.length === 0) {
      console.error(`Error: User "${username}" not found.`);
      const allUsers = await pool.query("SELECT username, role, active FROM users ORDER BY role, username");
      console.error("\nExisting users:");
      for (const u of allUsers.rows) {
        console.error(`  - ${u.username} (${u.role}) ${u.active ? "" : "[disabled]"}`);
      }
      process.exit(1);
    }

    const user = userResult.rows[0];
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    await pool.query("UPDATE users SET password = $1 WHERE id = $2", [hashedPassword, user.id]);

    console.log(`Password successfully reset for user "${user.username}" (${user.display_name || "no display name"}, role: ${user.role}).`);
  } catch (error: any) {
    console.error("Failed to reset password:", error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

resetAdminPassword();
