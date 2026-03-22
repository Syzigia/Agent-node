import { auth } from "@clerk/nextjs/server"
import { redirect } from "next/navigation"
import LandingV5 from "@/components/landing/LandingV5"
import "./landing-v5.css"

export default async function Page() {
  const { userId } = await auth()
  if (userId) redirect("/dashboard")

  return <LandingV5 />
}
