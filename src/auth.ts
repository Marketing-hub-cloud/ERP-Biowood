import NextAuth, { CredentialsSignin } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/db";

class InvalidLogin extends CredentialsSignin {
  code = "invalid";
}
/** แจ้งเฉพาะเมื่อรหัสผ่านถูกต้องแล้วเท่านั้น จึงไม่เปิดเผยว่าอีเมลนี้มีอยู่จริง */
class InactiveUser extends CredentialsSignin {
  code = "inactive";
}

let _dummy: string | undefined;
const dummyHash = () => (_dummy ??= bcrypt.hashSync("not-a-real-password", 10));

const loginSchema =z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1),
});

export const { handlers, auth, signIn, signOut } = NextAuth({
  session: { strategy: "jwt", maxAge: 60 * 60 * 12 },
  pages: { signIn: "/login" },
  trustHost: true,
  logger: {
    // รหัสผ่านผิด/บัญชีถูกหยุดเป็นเรื่องปกติ ไม่ต้องพิมพ์ stack trace
    error(error) {
      if (error instanceof CredentialsSignin || error.name === "CredentialsSignin") return;
      console.error(error);
    },
  },
  providers: [
    Credentials({
      credentials: { email: {}, password: {} },
      async authorize(raw) {
        const parsed = loginSchema.safeParse(raw);
        if (!parsed.success) throw new InvalidLogin();
        const user = await prisma.user.findUnique({ where: { email: parsed.data.email } });
        // เทียบ hash เสมอเพื่อไม่ให้เวลาตอบต่างกัน (กันการเดาอีเมล)
        const ok = await bcrypt.compare(parsed.data.password, user?.passwordHash ?? dummyHash());
        if (!user || !ok) throw new InvalidLogin();
        if (user.status !== "ACTIVE") throw new InactiveUser();
        await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
        return { id: user.id, email: user.email, name: `${user.firstName} ${user.lastName}` };
      },
    }),
  ],
  callbacks: {
    authorized({ auth }) {
      // ใช้ใน proxy: ต้องล็อกอินก่อน (สิทธิ์ละเอียดตรวจที่ page/route handler)
      return Boolean(auth?.user);
    },
    jwt({ token, user }) {
      if (user?.id) token.sub = user.id;
      return token;
    },
    session({ session, token }) {
      if (token.sub) session.user.id = token.sub;
      return session;
    },
  },
});
