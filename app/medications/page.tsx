import { redirect } from "next/navigation";

export default function MedicationsPage() {
  redirect("/lembretes?tipo=medication");
}
