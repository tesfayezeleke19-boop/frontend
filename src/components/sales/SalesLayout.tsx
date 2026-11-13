import { BrandLogo } from "@/components/BrandLogo";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router";
import { useAuth } from "@/hooks/use-auth";
import {
  displayEmail,
  displayNameOf,
  initialsOf,
} from "@/services/auth/profile";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  LayoutDashboard,
  ShoppingCart,
  Plus,
  LogOut,
  Menu,
  ChevronRight,
  Bell,
  User,
  Boxes,
  ScrollText,
  CreditCard,
} from "lucide-react";

const navItems = [
  {
    section: "Main",
    items: [{ label: "Dashboard", icon: LayoutDashboard, path: "/sales" }],
  },
  {
    section: "Operations",
    items: [
      { label: "Sales Invoice", icon: Plus, path: "/sales/new-invoice" },
      { label: "Contract Orders", icon: ScrollText, path: "/sales/contracts" },
      { label: "Credit Contracts", icon: CreditCard, path: "/sales/credit-contracts" },
      { label: "Transactions", icon: ShoppingCart, path: "/sales/transactions" },
      { label: "Inventory", icon: Boxes, path: "/sales/inventory" },
    ],
  },
];

interface SalesLayoutProps {
  children: React.ReactNode;
}

export default function SalesLayout({ children }: SalesLayoutProps) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const { user, signOut } = useAuth();

  const handleSignOut = async () => {
    await signOut();
    navigate("/auth");
  };

  const isActive = (path: string) => {
    if (path === "/sales") return location.pathname === "/sales";
    return location.pathname.startsWith(path);
  };

  const renderSidebar = () => (
    <div className="flex h-full flex-col bg-sidebar">
      {/* Brand */}
       <div className="flex min-w-0 items-center gap-2.5 px-3 py-3.5">
        <BrandLogo
          size={80}
          className="shrink-0 rounded-full"
        />

        <div className="min-w-0 flex-1">
          <div className="truncate font-heading text-sm font-semibold leading-none text-foreground">
            HATI PLC
          </div>
          <div className="mt-1 truncate font-mono text-[9px] uppercase tracking-[0.14em] text-violet">
            Admin Portal
          </div>
        </div>
      </div>

      <Separator className="bg-sidebar-border" />

      {/* Navigation */}
      <ScrollArea className="flex-1 px-2 py-3">
        {navItems.map((group) => (
          <div key={group.section} className="mb-4">
            <div className="mb-1 px-2 font-mono text-[9px] font-medium uppercase tracking-[0.18em] text-muted-foreground/70">
              {group.section}
            </div>
            {group.items.map((item) => (
              <NavLink
                key={item.path}
                to={item.path}
                onClick={() => setMobileOpen(false)}
                className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors ${
                  isActive(item.path)
                    ? "bg-accent text-foreground"
                    : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
                }`}
              >
                <item.icon className="size-4 shrink-0" />
                <span>{item.label}</span>
              </NavLink>
            ))}
          </div>
        ))}
      </ScrollArea>

      {/* Footer */}
      <div className="border-t border-border p-3">
        <button
          onClick={handleSignOut}
          className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
        >
          <LogOut className="size-4" />
          <span>Sign Out</span>
        </button>
      </div>
    </div>
  );

  // Generate breadcrumbs
  const pathParts = location.pathname.split("/").filter(Boolean);
  const breadcrumbs = pathParts.map((part, i) => {
    const path = "/" + pathParts.slice(0, i + 1).join("/");
    const label =
      part === "sales"
        ? "Sales"
        : part === "new-invoice"
          ? "New Invoice"
          : part === "invoices"
            ? "Invoice"
          : part === "transactions"
            ? "Transactions"
            : part === "detail"
                ? "Detail"
                : part.charAt(0).toUpperCase() + part.slice(1);
    return { label, path };
  });

  return (
    <div className="flex h-screen bg-background">
      {/* Desktop Sidebar */}
      <aside className="hidden w-[220px] shrink-0 border-r border-border md:block">
        {renderSidebar()}
      </aside>

      {/* Main Content */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Top Bar */}
        <header className="flex h-12 shrink-0 items-center justify-between border-b border-border bg-sidebar px-4">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setMobileOpen(true)}
              className="md:hidden"
            >
              <Menu className="size-5 text-muted-foreground" />
            </button>

            {/* Breadcrumbs */}
            <nav className="flex items-center gap-1 font-mono text-[11px] text-muted-foreground/70">
              {breadcrumbs.map((bc, i) => (
                <span key={bc.path} className="flex items-center gap-1">
                  {i > 0 && <ChevronRight className="size-3" />}
                  {i === breadcrumbs.length - 1 ? (
                    <span className="font-medium text-foreground">
                      {bc.label}
                    </span>
                  ) : (
                    <button
                      onClick={() => navigate(bc.path)}
                      className="transition-colors hover:text-muted-foreground"
                    >
                      {bc.label}
                    </button>
                  )}
                </span>
              ))}
            </nav>
          </div>

          <div className="flex items-center gap-3">
            <ThemeToggle />

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex items-center gap-2 rounded-lg px-2 py-1 transition-colors hover:bg-foreground/5">
                  <div className="flex size-7 items-center justify-center rounded-full border border-input bg-popover text-xs font-medium text-foreground">
                    {initialsOf(user)}
                  </div>
                  <div className="hidden text-left sm:block">
                    <div className="text-xs font-medium text-foreground">
                      {displayNameOf(user?.name, user?.email)}
                    </div>
                    <div className="font-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground/70">
                      "Sales Staff"
                    </div>
                  </div>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56 border-input bg-popover">
                <div className="px-2 py-1.5">
                  <div className="truncate text-xs font-medium text-foreground">
                    {displayNameOf(user?.name, user?.email)}
                  </div>
                  <div className="truncate font-mono text-[10px] text-muted-foreground">
                    {displayEmail(user?.email)}
                  </div>
                </div>
                <DropdownMenuSeparator className="bg-muted" />
                <DropdownMenuItem
  onClick={() => navigate("/sales/profile")}
  className="gap-2 text-xs text-foreground"
>
  <User className="size-3.5" />
  Profile
</DropdownMenuItem>
                <DropdownMenuSeparator className="bg-muted" />
                <DropdownMenuItem
                  onClick={handleSignOut}
                  className="gap-2 text-xs text-destructive"
                >
                  <LogOut className="size-3.5" />
                  Sign Out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        {/* Page Content */}
        <main className="flex-1 overflow-auto">
          <div className="mx-auto max-w-7xl p-6">{children}</div>
        </main>
      </div>

      {/* Mobile Sidebar */}
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="w-[260px] border-r border-border bg-sidebar p-0">
          <SheetHeader className="sr-only">
            <SheetTitle>Sales Navigation</SheetTitle>
          </SheetHeader>
          {renderSidebar()}
        </SheetContent>
      </Sheet>
    </div>
  );
}
