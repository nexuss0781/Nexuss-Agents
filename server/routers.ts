import { clearLocalSession } from "./localAuth";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";
import { playgroundRouter } from "./routers/playground";

export const appRouter = router({
  // if you need to use socket.io, read and register route in server/_core/index.ts, all api should start with '/api/' so that the gateway can route correctly
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      clearLocalSession(ctx.req, ctx.res);
      return { success: true } as const;
    }),
  }),
  playground: playgroundRouter,
});

export type AppRouter = typeof appRouter;
