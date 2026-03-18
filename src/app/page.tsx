import { redirect } from "next/navigation";

/**
 * Ziarem Enterprise: root redirects to dashboard (realty).
 */
export default function Home() {
  redirect("/realty");
}
