import { createFileRoute } from "@tanstack/react-router";
import { SurgeGame } from "@/components/surge/SurgeGame";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Surge — a two-player charge-and-jump strategy" },
      {
        name: "description",
        content:
          "Surge is a tense 5×6 strategy duel. Move forward, capture diagonally, and spend rare Surge tokens to leap — but every jump leaves you exposed.",
      },
      { property: "og:title", content: "Surge" },
      {
        property: "og:description",
        content:
          "A scarce, electric two-player game of forward pressure and exposed jumps.",
      },
    ],
  }),
  component: Index,
});

function Index() {
  return <SurgeGame />;
}
