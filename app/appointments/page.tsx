import { redirect } from "next/navigation";

export default function AppointmentsPage() {
  redirect("/lembretes?tipo=appointment");
}
