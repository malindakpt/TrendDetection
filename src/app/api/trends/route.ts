import { readTrends } from "@/dashboard/readResults";

export async function GET() {
  const trends = await readTrends();

  return Response.json(trends);
}