import { ClientDetailView } from "@/components/dashboard/client-detail-view";

export const metadata = {
  title: "Cliente | SOLOMON",
};

export default async function ClientDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ClientDetailView clientId={id} />;
}
