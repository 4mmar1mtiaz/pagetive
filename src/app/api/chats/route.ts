import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { currentSession } from "@/lib/account";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await currentSession();
  const chats = await prisma.chat.findMany({
    where: { ownerId: session.accountId },
    orderBy: { updatedAt: "desc" },
    take: 50,
  });
  return NextResponse.json({ chats });
}

export async function POST() {
  const session = await currentSession();
  const chat = await prisma.chat.create({ data: { title: "New page", ownerId: session.accountId } });
  return NextResponse.json({ chat });
}
