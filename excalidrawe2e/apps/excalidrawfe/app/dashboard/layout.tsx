import { League_Gothic, Newsreader } from "next/font/google";
import "./dashboard.css";

// The dashboard's two faces. Loaded here rather than in the root layout so the
// canvas and sign-in pages do not pay for fonts they never use.
const leagueGothic = League_Gothic({
  subsets: ["latin"],
  variable: "--font-league-gothic",
  display: "swap",
});

const newsreader = Newsreader({
  subsets: ["latin"],
  variable: "--font-newsreader",
  style: ["normal", "italic"],
  display: "swap",
});

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return <div className={`${leagueGothic.variable} ${newsreader.variable}`}>{children}</div>;
}
