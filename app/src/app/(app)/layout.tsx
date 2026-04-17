import { AppShell } from "@/components/app-shell";

export default function AppRoutesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AppShell>{children}</AppShell>;
}
