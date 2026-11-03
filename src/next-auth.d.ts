import "next-auth";

declare module "next-auth" {
  interface User {
    sessionVersion?: number;
  }
  interface Session {
    sessionVersion?: number;
  }
}

declare module "@auth/core/jwt" {
  interface JWT {
    sessionVersion?: number;
  }
}
