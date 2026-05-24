import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { peekGenericToken } from "@/lib/ddb";
import { AcceptForm } from "./_accept-form";

export default async function EntrarPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;

  // 1. No token
  if (!token) {
    return <ErrorPage message="Convite ausente." />;
  }

  // 2. Not logged in — redirect to sign in with callbackUrl
  const session = await auth();
  if (!session?.user?.id) {
    const callbackUrl = encodeURIComponent(`/casa/entrar?token=${token}`);
    redirect(`/api/auth/signin?callbackUrl=${callbackUrl}`);
  }

  // 3. Peek token without consuming it
  const payloadJson = await peekGenericToken(token);
  if (!payloadJson) {
    return <ErrorPage message="Convite inválido ou expirado." />;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let payload: any;
  try {
    payload = JSON.parse(payloadJson);
  } catch {
    return <ErrorPage message="Convite corrompido." />;
  }

  // 4. Owner cannot accept their own invite
  if (payload.ownerSub === session.user.id) {
    return <ErrorPage message="Você não pode aceitar seu próprio convite." />;
  }

  // 5. Email mismatch — invites are email-bound for both partner and caregiver.
  if (payload.inviteeEmail && payload.inviteeEmail !== session.user.email) {
    return (
      <ErrorPage
        message={`Este convite foi gerado para outro email (${payload.inviteeEmail}).`}
      />
    );
  }

  // 6. Valid — render accept form
  return (
    <div className="mx-auto flex min-h-dvh max-w-[480px] flex-col items-stretch justify-center px-6">
      <div className="flex items-baseline gap-3">
        <span
          aria-hidden
          className="inline-block size-2.5 rounded-full"
          style={{ background: "var(--color-sage)" }}
        />
        <span className="font-display text-[22px] leading-none tracking-tight text-ink">
          medicamento
        </span>
      </div>

      <h1 className="mt-10 font-display text-[40px] leading-[1.05] tracking-tight text-ink">
        Convite recebido
      </h1>

      <AcceptForm token={token} payload={payload} />
    </div>
  );
}

function ErrorPage({ message }: { message: string }) {
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
      <p className="mt-10 font-display text-[26px] leading-snug tracking-tight text-ink">
        {message}
      </p>
      <a
        href="/"
        className="mt-6 text-[13px] text-ink-soft underline decoration-edge-2 underline-offset-4 hover:text-ink"
      >
        voltar ao inicio
      </a>
    </div>
  );
}
