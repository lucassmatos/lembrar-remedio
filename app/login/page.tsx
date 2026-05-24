import { signIn } from "@/auth";
import { safeFromParam } from "@/lib/login-redirect";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string }>;
}) {
  const { from } = await searchParams;
  const callbackUrl = safeFromParam(from);

  async function login() {
    "use server";
    await signIn("google", { redirectTo: callbackUrl });
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-[480px] flex-col items-stretch justify-center px-6">
      <div className="flex items-baseline gap-3">
        <span
          aria-hidden
          className="inline-block size-2.5 rounded-full"
          style={{ background: "var(--color-clay)" }}
        />
        <span className="font-display text-[22px] leading-none tracking-tight text-ink">
          medicamento
        </span>
      </div>

      <h1 className="mt-10 font-display text-[44px] leading-[1.05] tracking-tight text-ink">
        Entrar
      </h1>
      <p className="mt-3 text-[15px] leading-relaxed text-ink-soft">
        Use sua conta Google. Pedimos apenas seu nome e email pra te identificar.
        Nada além.
      </p>

      <form action={login} className="mt-10">
        <button
          type="submit"
          className="w-full rounded-full bg-ink px-5 py-3.5 text-[15px] font-medium tracking-tight text-paper transition-opacity hover:opacity-90"
        >
          Continuar com Google
        </button>
      </form>

      <p className="mt-8 text-[12.5px] leading-relaxed text-ink-faint">
        Ao entrar você concorda em deixar a gente salvar uma lista dos seus
        medicamentos e dos seus horários. É só isso.
      </p>
    </div>
  );
}
