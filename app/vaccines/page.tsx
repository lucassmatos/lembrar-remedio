import { redirect } from "next/navigation";

export default function VaccinesPage() {
  redirect("/lembretes?tipo=vaccine");
}
