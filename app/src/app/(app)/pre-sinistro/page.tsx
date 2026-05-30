import { Suspense } from "react";
import { PreSinistroView } from "@/components/pre-sinistro/pre-sinistro-view";

export const metadata = {
  title: "Pré-Sinistro",
};

export default function PreSinistroPage() {
  return (
    <Suspense fallback={null}>
      <PreSinistroView />
    </Suspense>
  );
}
