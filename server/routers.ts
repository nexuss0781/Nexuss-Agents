import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { createLocalUser } from "./db";
import { authenticatePassword, clearLocalSession, establishLocalSession, hashPassword } from "./localAuth";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";
import { playgroundRouter } from "./routers/playground";

const accountInput = z.object({
  email: z.string().trim().email().max(320).transform(email => email.toLowerCase()),
  password: z.string().min(8, "Use at least 8 characters").max(128),
});

export const appRouter = router({
    // if you need to use socket.io, read and register route in server/_core/index.ts, all api should start with '/api/' so that the gateway can route correctly
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    register: publicProcedure.input(accountInput.extend({ name: z.string().trim().min(2).max(80) })).mutation(async ({ ctx, input }) => {
      try {
        const { password, ...account } = input;
        const user = await createLocalUser({ ...account, passwordHash: await hashPassword(password) });
        await establishLocalSession(ctx.req, ctx.res, user.id);
        return user;
      } catch (error) {
        if (error instanceof Error && error.message.includes("already exists")) {
          throw new TRPCError({ code: "CONFLICT", message: "An account with this email already exists." });
        }
        throw error;
      }
    }),
    login: publicProcedure.input(accountInput).mutation(async ({ ctx, input }) => {
      const user = await authenticatePassword(input.email, input.password);
      if (!user) throw new TRPCError({ code: "UNAUTHORIZED", message: "Incorrect email or password." });
      await establishLocalSession(ctx.req, ctx.res, user.id);
      return user;
    }),
    logout: publicProcedure.mutation(({ ctx }) => {
      clearLocalSession(ctx.req, ctx.res);
      return { success: true } as const;
    }),
  }),
  playground: playgroundRouter,
});

export type AppRouter = typeof appRouter;
