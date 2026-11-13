import { motion } from "framer-motion";
import { useNavigate } from "react-router";
import { ArrowLeft } from "lucide-react";

export default function NotFound() {
  const navigate = useNavigate();

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.4 }}
      className="bg-grid flex min-h-screen flex-col bg-background"
    >
      <div className="flex flex-1 flex-col items-center justify-center px-6">
        <div className="text-center">
          <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-success">
            Error 404
          </div>
          <h1 className="mt-4 font-heading text-5xl font-semibold tracking-tight text-foreground">
            Page not found
          </h1>
          <p className="mx-auto mt-4 max-w-sm text-sm leading-relaxed text-muted-foreground">
            The page you're looking for doesn't exist or has been moved.
          </p>
          <button
            onClick={() => navigate("/")}
            className="mt-8 inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            <ArrowLeft className="size-4" />
            Back to HATI PLC
          </button>
        </div>
      </div>
    </motion.div>
  );
}
