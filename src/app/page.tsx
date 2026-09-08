import { TrendDashboard } from "@/dashboard/TrendDashboard";
import { readAlerts } from "@/dashboard/readAlerts";

export default async function HomePage() {
  return <TrendDashboard alerts={await readAlerts()} />;
}