import { redirect } from "next/navigation";
import { getActor } from "@/lib/game/actor";

export default async function Home() {
  const actor = await getActor();

  if (actor.kind === "staff") redirect("/staff");
  if (actor.kind === "team") redirect("/team");
  redirect("/login");
}
