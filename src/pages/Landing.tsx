import { BrandLogo } from "@/components/BrandLogo";
import { ThemeToggle } from "@/components/ThemeToggle";
import { motion } from "framer-motion";
import {
  ArrowRight,
  BarChart3,
  Building2,
  ChevronRight,
  FileText,
  Package,
  Shield,
  TrendingUp,
  Users,
  Layers,
  GitBranch,
  Database,
} from "lucide-react";
import { useNavigate } from "react-router";

export default function Landing() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <header className="sticky top-0 z-40 border-b border-border bg-background/85 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3.5">
          <div className="flex items-center gap-3">
            <BrandLogo size={40} />
            <div>
              <div className="font-heading text-lg font-semibold leading-none tracking-tight text-foreground">
                HATI PLC
              </div>
              <div className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground/70">
                Operations Platform
              </div>
            </div>
          </div>
          <nav className="flex items-center gap-6 text-sm">
            <a
              href="#systems"
              className="hidden text-muted-foreground transition-colors hover:text-foreground sm:block"
            >
              Systems
            </a>
            <a
              href="#features"
              className="hidden text-muted-foreground transition-colors hover:text-foreground sm:block"
            >
              Capabilities
            </a>
            <ThemeToggle className="p-2" />
            <button
              onClick={() => navigate("/auth?returnTo=/sales")}
              className="rounded-lg border border-input bg-popover px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
            >
              Sign In
            </button>
          </nav>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="bg-grid pointer-events-none absolute inset-0" />
        <div className="pointer-events-none absolute inset-x-0 top-0 h-64 bg-gradient-to-b from-success/[0.07] to-transparent" />
        <div className="relative mx-auto max-w-6xl px-6 py-24 lg:py-32">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="max-w-3xl"
          >
            <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-input bg-card px-3 py-1 font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
              <span className="size-1.5 rounded-full bg-success" />
              Internal Operations Platform
            </div>
            <h1 className="font-heading text-4xl font-semibold leading-[1.08] tracking-tight text-foreground lg:text-6xl">
              One source of truth
              <br />
              for your entire operation.
            </h1>
            <p className="mt-6 max-w-xl text-base leading-relaxed text-muted-foreground lg:text-lg">
              hati plc ERP connects sales, finance, and administration into a single
              workflow — from order creation through approval and payment, to
              payroll, expenses, and reporting.
            </p>
            <div className="mt-9 flex items-center gap-3">
              <button
                onClick={() => navigate("/auth?returnTo=/sales")}
                className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
              >
                Enter Sales Portal
                <ArrowRight className="size-4" />
              </button>
              <button
                onClick={() => navigate("/auth?returnTo=/finance")}
                className="inline-flex items-center gap-2 rounded-lg border border-input px-5 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-popover"
              >
                Enter Finance Portal
                <ChevronRight className="size-4" />
              </button>
              <button
                onClick={() => navigate("/auth?returnTo=/hr")}
                className="inline-flex items-center gap-2 rounded-lg border border-input px-5 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-popover"
              >
                Enter HR Portal
                <ChevronRight className="size-4" />
              </button>
              <button
                onClick={() => navigate("/auth?returnTo=/admin")}
                className="inline-flex items-center gap-2 rounded-lg border border-input px-5 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-popover"
              >
                Enter Admin Portal
                <ChevronRight className="size-4" />
              </button>
            </div>

            {/* Terminal strip */}
            <div className="mt-12 max-w-xl overflow-hidden rounded-lg border border-border bg-sidebar">
              <div className="flex items-center gap-1.5 border-b border-border px-3.5 py-2">
                <span className="size-2 rounded-full bg-popover" />
                <span className="size-2 rounded-full bg-popover" />
                <span className="size-2 rounded-full bg-popover" />
                <span className="ml-2 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground/70">
                  HATI PLC — sales
                </span>
              </div>
              <div className="space-y-1.5 px-4 py-3.5 font-mono text-xs leading-relaxed">
                <div className="text-muted-foreground">
                  <span className="text-success">$</span> HATI PLC order create
                  --customer "ABC Construction PLC" --tin 0012345678
                </div>
                <div className="text-success">✓ ORDER-0001 created</div>
                <div className="text-muted-foreground">
                  <span className="text-success">$</span> HATI PLC order submit
                  ORDER-0001
                </div>
                <div className="text-warning">→ queued for finance review</div>
              </div>
            </div>
          </motion.div>
        </div>
      </section>

      {/* Capability strip */}
      <section className="border-y border-border bg-sidebar">
        <div className="mx-auto grid max-w-6xl grid-cols-2 gap-px lg:grid-cols-4">
          {[
            { label: "Sales Management", icon: Package },
            { label: "Financial Control", icon: BarChart3 },
            { label: "HR & Payroll", icon: Users },
            { label: "System Administration", icon: Shield },
          ].map((item) => (
            <div
              key={item.label}
              className="flex items-center gap-3 px-6 py-5"
            >
              <item.icon className="size-4 text-muted-foreground/70" />
              <span className="font-mono text-xs uppercase tracking-[0.12em] text-muted-foreground">
                {item.label}
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* Systems */}
      <section id="systems" className="relative px-6 py-20 lg:py-24">
        <div className="mx-auto max-w-6xl">
          <div className="mb-12 flex items-end justify-between">
            <div>
              <div className="mb-3 font-mono text-[11px] uppercase tracking-[0.18em] text-success">
                /systems
              </div>
              <h2 className="font-heading text-3xl font-semibold tracking-tight text-foreground">
                Three systems, one workflow
              </h2>
              <p className="mt-3 max-w-lg text-sm leading-relaxed text-muted-foreground">
                Each department operates with its own focused interface, while
                shared business processes connect them end to end.
              </p>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-4">
            {[
              {
                title: "Sales",
                status: "Available",
                live: true,
                desc: "Create orders, track every transaction from submission through finance approval, and compile approved orders into structured reports.",
                icon: Package,
                action: () => navigate("/auth?returnTo=/sales"),
                cta: "Enter Sales Portal",
              },
              {
                title: "Finance",
                status: "Available",
                live: true,
                desc: "Review and approve sales transactions, confirm payments, post financial records, and analyze revenue across the business.",
                icon: BarChart3,
                action: () => navigate("/auth?returnTo=/finance"),
                cta: "Enter Finance Portal",
              },
              {
                title: "HR",
                status: "Available",
                live: true,
                desc: "Manage employees, track attendance, process leave requests, and handle payroll across all departments.",
                icon: Users,
                action: () => navigate("/auth?returnTo=/hr"),
                cta: "Enter HR Portal",
              },
              {
                title: "Administration",
                status: "Available",
                live: true,
                desc: "Manage users, roles, and permissions. Configure the system, control access, and audit everything that happens inside it.",
                icon: Shield,
                action: () => navigate("/auth?returnTo=/admin"),
                cta: "Enter Admin Portal",
              },
            ].map((sys) => (
              <motion.div
                key={sys.title}
                initial={{ opacity: 0, y: 16 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.4 }}
                className="group flex flex-col rounded-xl border border-border bg-card p-6 transition-colors hover:border-foreground/20"
              >
                <div className="mb-5 flex items-center justify-between">
                  <div className="flex size-9 items-center justify-center rounded-lg border border-input bg-popover">
                    <sys.icon className="size-4 text-foreground" />
                  </div>
                  <span
                    className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em] ${
                      sys.live
                        ? "border-success-border bg-success-soft text-success"
                        : "border-input bg-muted text-muted-foreground"
                    }`}
                  >
                    <span
                      className={`size-1 rounded-full ${
                        sys.live ? "bg-success" : "bg-muted"
                      }`}
                    />
                    {sys.status}
                  </span>
                </div>
                <h3 className="font-heading text-xl font-semibold text-foreground">
                  {sys.title}
                </h3>
                <p className="mt-2 flex-1 text-sm leading-relaxed text-muted-foreground">
                  {sys.desc}
                </p>
                <button
                  onClick={sys.action}
                  disabled={!sys.live}
                  className={`mt-6 inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                    sys.live
                      ? "bg-primary text-primary-foreground hover:bg-primary/90"
                      : "cursor-not-allowed border border-input text-muted-foreground/70"
                  }`}
                >
                  {sys.cta}
                  {sys.live && <ArrowRight className="size-3.5" />}
                </button>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Capabilities */}
      <section
        id="features"
        className="border-t border-border bg-sidebar px-6 py-20 lg:py-24"
      >
        <div className="mx-auto max-w-6xl">
          <div className="mb-12">
            <div className="mb-3 font-mono text-[11px] uppercase tracking-[0.18em] text-success">
              /capabilities
            </div>
            <h2 className="font-heading text-3xl font-semibold tracking-tight text-foreground">
              Built for the way operations actually run
            </h2>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[
              {
                title: "Order Management",
                desc: "Create and track orders with automatic numbering, customer records, and VAT-aware calculations.",
                icon: FileText,
              },
              {
                title: "Transaction Workflow",
                desc: "Orders move through submission, finance review, approval, and payment confirmation — with a clear trail at every step.",
                icon: GitBranch,
              },
              {
                title: "Sales Reporting",
                desc: "Group approved transactions into numbered reports for documentation, analysis, and finance.",
                icon: Layers,
              },
              {
                title: "Finance Integration",
                desc: "Every sale feeds directly into finance for review, approval, and payment processing.",
                icon: TrendingUp,
              },
              {
                title: "HR & Payroll",
                desc: "Employee records, attendance, leave, and payroll in one place, tied to the approval workflow.",
                icon: Users,
              },
              {
                title: "Financial Reporting",
                desc: "Revenue, expenses, and payroll summaries with clear, decision-ready dashboards.",
                icon: Database,
              },
            ].map((feature) => (
              <div
                key={feature.title}
                className="group rounded-xl border border-border bg-card p-5 transition-colors hover:border-foreground/20"
              >
                <feature.icon className="mb-3 size-4 text-success" />
                <h3 className="text-sm font-semibold text-foreground">
                  {feature.title}
                </h3>
                <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                  {feature.desc}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="px-6 py-20 lg:py-24">
        <div className="mx-auto max-w-6xl">
          <div className="bg-grid relative overflow-hidden rounded-xl border border-border bg-card p-12 text-center">
            <div className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-success/[0.06] to-transparent" />
            <div className="relative">
              <h2 className="font-heading text-3xl font-semibold tracking-tight text-foreground">
                Ready to operate?
              </h2>
              <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-muted-foreground">
                Sales creates the orders, Finance reviews and confirms them,
                HR manages people and payroll, and every transaction stays
                connected end to end.
              </p>
              <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
                <button
                  onClick={() => navigate("/auth?returnTo=/sales")}
                  className="inline-flex items-center gap-2 rounded-lg bg-primary px-6 py-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
                >
                  Enter Sales Portal
                  <ArrowRight className="size-4" />
                </button>
                <button
                  onClick={() => navigate("/auth?returnTo=/finance")}
                  className="inline-flex items-center gap-2 rounded-lg border border-input px-6 py-3 text-sm font-medium text-foreground transition-colors hover:bg-popover"
                >
                  Enter Finance Portal
                  <ArrowRight className="size-4" />
                </button>
                <button
                  onClick={() => navigate("/auth?returnTo=/hr")}
                  className="inline-flex items-center gap-2 rounded-lg border border-input px-6 py-3 text-sm font-medium text-foreground transition-colors hover:bg-popover"
                >
                  Enter HR Portal
                  <ArrowRight className="size-4" />
                </button>
                <button
                  onClick={() => navigate("/auth?returnTo=/admin")}
                  className="inline-flex items-center gap-2 rounded-lg border border-input px-6 py-3 text-sm font-medium text-foreground transition-colors hover:bg-popover"
                >
                  Enter Admin Portal
                  <ArrowRight className="size-4" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border px-6 py-8">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 text-xs text-muted-foreground/70 sm:flex-row">
          <div className="flex items-center gap-2">
            <Building2 className="size-3.5" />
            <span className="font-medium text-muted-foreground">HATI PLC</span>
          </div>
          <span className="font-mono text-[10px] uppercase tracking-[0.16em]">
            Enterprise Resource Planning · Internal Use
          </span>
        </div>
      </footer>
    </div>
  );
}
