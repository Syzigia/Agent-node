import { auth } from "@clerk/nextjs/server"
import { redirect } from "next/navigation"
import LandingV5 from "@/components/landing/LandingV5"
import { isWhitelisted } from "@/lib/whitelist"
import "./landing-v5.css"

export default async function Page() {
  const { userId } = await auth()
  if (userId) {
    if (isWhitelisted(userId)) {
      redirect("/dashboard")
    } else {
      redirect("/waitlist")
    }
  }

  return <LandingV5 />
}
