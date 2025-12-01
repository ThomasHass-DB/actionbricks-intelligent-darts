import { createFileRoute } from "@tanstack/react-router";
import Navbar from "@/components/apx/navbar";
import { DartsVideoStream } from "@/components/darts/VideoStream";
import { Target } from "lucide-react";
import { ModeToggle } from "@/components/apx/mode-toggle";

export const Route = createFileRoute("/")({
  component: () => <Index />,
});

function Index() {
  return (
    <div className="relative h-screen w-screen overflow-hidden flex flex-col bg-background">
      {/* Navbar */}
      <Navbar 
        leftContent={
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <Target className="h-8 w-8 text-primary" />
              <span className="text-xl font-bold">Intelligent Darts</span>
            </div>
          </div>
        }
        rightContent={
          <div className="flex items-center gap-4">
            {/* Powered by Databricks */}
            <div className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-md bg-gradient-to-r from-red-500/10 to-orange-500/10 border border-red-500/20">
              <span className="text-xs text-muted-foreground">Powered by</span>
              <span className="text-sm font-bold bg-gradient-to-r from-red-500 to-orange-500 bg-clip-text text-transparent">
                Databricks
              </span>
            </div>
            <ModeToggle />
          </div>
        }
      />

      {/* Main content */}
      <main className="flex-1 overflow-auto">
        <div className="container mx-auto p-6 max-w-6xl">
          <DartsVideoStream />
        </div>
      </main>
    </div>
  );
}
