import { Toaster } from "@/components/ui/sonner";
import { RequireAuth } from "@/components/RequireAuth";
import { USER_ROLES } from "@/services/auth";
import React, { StrictMode, lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { ThemeProvider } from "next-themes";
import { BrowserRouter, Route, Routes } from "react-router";
import "./index.css";
import EvidenceImageViewer from "@/pages/EvidenceImageViewer";
// Authentication and fallback pages
const AuthPage = lazy(() => import("./pages/Auth.tsx"));
const NotFound = lazy(() => import("./pages/NotFound.tsx"));


// Sales Module
const SalesLayout = lazy(() => import("./components/sales/SalesLayout.tsx"));
const SalesDashboard = lazy(() => import("./pages/sales/SalesDashboard.tsx"));
const SalesInvoicePage = lazy(
  () => import("./pages/sales/SalesInvoicePage.tsx"),
);
const Transactions = lazy(() => import("./pages/sales/Transactions.tsx"));
const SalesInventory = lazy(() => import("./pages/sales/SalesInventory.tsx"));
const TransactionDetail = lazy(
  () => import("./pages/sales/TransactionDetail.tsx"),
);

// Contracts — shared by Sales and Finance
const Contracts = lazy(() => import("./pages/contracts/Contracts.tsx"));
const ContractDetail = lazy(
  () => import("./pages/contracts/ContractDetail.tsx"),
);

// Credit Contracts — additive workflow alongside the existing contracts module
const CreditContracts = lazy(
  () => import("./pages/credit-contracts/CreditContracts.tsx"),
);
const CreditContractDetail = lazy(
  () => import("./pages/credit-contracts/CreditContractDetail.tsx"),
);

// Finance Module
const FinanceLayout = lazy(
  () => import("./components/finance/FinanceLayout.tsx"),
);
const FinanceDashboard = lazy(
  () => import("./pages/finance/FinanceDashboard.tsx"),
);
const SalesReview = lazy(() => import("./pages/finance/SalesReview.tsx"));
const FinanceTransactions = lazy(
  () => import("./pages/finance/FinanceTransactions.tsx"),
);
const FinanceOrderDetail = lazy(
  () => import("./pages/finance/FinanceOrderDetail.tsx"),
);
const Payments = lazy(() => import("./pages/finance/Payments.tsx"));
const FinancialRecords = lazy(
  () => import("./pages/finance/FinancialRecords.tsx"),
);
const Expenses = lazy(() => import("./pages/finance/Expenses.tsx"));
const FinanceInventory = lazy(
  () => import("./pages/finance/FinanceInventory.tsx"),
);
const RoyaltyReports = lazy(
  () => import("./pages/finance/RoyaltyReports.tsx"),
);
const FinancialReports = lazy(
  () => import("./pages/finance/FinancialReports.tsx"),
);
const PayrollReview = lazy(() => import("./pages/finance/PayrollReview.tsx"));

// HR Module
const HrLayout = lazy(() => import("./components/hr/HrLayout.tsx"));
const HrDashboard = lazy(() => import("./pages/hr/HrDashboard.tsx"));
const Employees = lazy(() => import("./pages/hr/Employees.tsx"));
const NewEmployee = lazy(() => import("./pages/hr/NewEmployee.tsx"));
const EmployeeDetail = lazy(() => import("./pages/hr/EmployeeDetail.tsx"));
const EditEmployee = lazy(() => import("./pages/hr/EditEmployee.tsx"));
const Attendance = lazy(() => import("./pages/hr/Attendance.tsx"));
const Leave = lazy(() => import("./pages/hr/Leave.tsx"));
const Payroll = lazy(() => import("./pages/hr/Payroll.tsx"));

// Admin Module
const AdminLayout = lazy(() => import("./components/admin/AdminLayout.tsx"));
const AdminDashboard = lazy(() => import("./pages/admin/AdminDashboard.tsx"));
const AdminSalesReports = lazy(
  () => import("./pages/admin/AdminSalesReports.tsx"),
);
const AdminFinancialReports = lazy(
  () => import("./pages/admin/AdminFinancialReports.tsx"),
);
const AdminHRReports = lazy(() => import("./pages/admin/AdminHRReports.tsx"));
const AdminInventoryReports = lazy(
  () => import("./pages/admin/AdminInventoryReports.tsx"),
);
const AdminMonitoring = lazy(
  () => import("./pages/admin/AdminMonitoring.tsx"),
);
const AdminUsers = lazy(() => import("./pages/admin/AdminUsers.tsx"));
const AdminExpenses = lazy(() => import("./pages/admin/AdminExpenses.tsx"));
const AdminOperationalSettings = lazy(
  () => import("./pages/admin/OperationalSettings.tsx"),
);

// Shared Profile page — used by all four roles
const Profile = lazy(() => import("./pages/profile/Profile.tsx"));

// Loading screen while pages load
function RouteLoading() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="animate-pulse text-muted-foreground">
        Loading...
      </div>
    </div>
  );
}

// Display runtime errors instead of a blank page
class RootErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; message: string; stack: string }
> {
  state = { hasError: false, message: "", stack: "" };

  static getDerivedStateFromError(error: Error) {
    return {
      hasError: true,
      message: error.message || "Unknown runtime error",
      stack: error.stack || "",
    };
  }

  componentDidCatch(error: Error) {
    console.error("[HATI PLC] Application error:", error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-background text-foreground p-6">
          <div className="max-w-lg text-center">
            <p className="text-sm font-semibold">
              Application error
            </p>
            <p className="mt-2 text-xs text-muted-foreground break-words">
              {this.state.message}
            </p>
            {this.state.stack && (
              <pre className="mt-3 text-left text-[10px] leading-4 text-muted-foreground/80 max-h-40 overflow-auto rounded border border-border/60 p-2">
                {this.state.stack}
              </pre>
            )}
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

// Sales module routes
function SalesRoutes() {
  return (
    <SalesLayout>
      <Routes>
        <Route path="profile" element={<Profile />} />
        <Route index element={<SalesDashboard />} />
        <Route path="new-invoice" element={<SalesInvoicePage />} />
        <Route path="invoices/:id/edit" element={<SalesInvoicePage />} />
        <Route path="transactions" element={<Transactions />} />
        <Route path="inventory" element={<SalesInventory />} />
        <Route path="contracts" element={<Contracts />} />
        <Route path="contracts/:id" element={<ContractDetail />} />
        <Route path="credit-contracts" element={<CreditContracts />} />
        <Route path="credit-contracts/:id" element={<CreditContractDetail />} />
        <Route
          path="transactions/detail/:id"
          element={<TransactionDetail />}
        />
      </Routes>
    </SalesLayout>
  );
}

// Finance module routes
function FinanceRoutes() {
  return (
    <FinanceLayout>
      <Routes>
        <Route path="profile" element={<Profile />} />
        <Route index element={<FinanceDashboard />} />
        <Route path="review" element={<SalesReview />} />
        <Route path="contracts" element={<Contracts />} />
        <Route path="contracts/:id" element={<ContractDetail />} />
        <Route path="credit-contracts" element={<CreditContracts />} />
        <Route path="credit-contracts/:id" element={<CreditContractDetail />} />
        <Route path="transactions" element={<FinanceTransactions />} />
        <Route
          path="review/detail/:id"
          element={<FinanceOrderDetail />}
        />
        <Route path="payments" element={<Payments />} />
        <Route path="records" element={<FinancialRecords />} />
        <Route path="royalty" element={<RoyaltyReports />} />
        <Route path="expenses" element={<Expenses />} />
        <Route path="inventory" element={<FinanceInventory />} />
        <Route path="reports" element={<FinancialReports />} />
        <Route path="payroll-review" element={<PayrollReview />} />
      </Routes>
    </FinanceLayout>
  );
}

// HR module routes
function HrRoutes() {
  return (
    <HrLayout>
      <Routes>
        <Route path="profile" element={<Profile />} />
        <Route index element={<HrDashboard />} />
        <Route path="employees" element={<Employees />} />
        <Route path="employees/new" element={<NewEmployee />} />
        <Route path="employees/:id" element={<EmployeeDetail />} />
        <Route path="employees/:id/edit" element={<EditEmployee />} />
        <Route path="attendance" element={<Attendance />} />
        <Route path="leave" element={<Leave />} />
        <Route path="payroll" element={<Payroll />} />
      </Routes>
    </HrLayout>
  );
}

// Admin module routes
function AdminRoutes() {
  return (
    <AdminLayout>
      <Routes>
        <Route path="profile" element={<Profile />} />
        <Route index element={<AdminDashboard />} />
        <Route path="sales-reports" element={<AdminSalesReports />} />
        <Route
          path="financial-reports"
          element={<AdminFinancialReports />}
        />
        <Route path="hr-reports" element={<AdminHRReports />} />
        <Route
          path="inventory-reports"
          element={<AdminInventoryReports />}
        />
        <Route path="monitoring" element={<AdminMonitoring />} />
        <Route path="users" element={<AdminUsers />} />
        <Route path="expenses" element={<AdminExpenses />} />

        {/* Operational Settings — Admin only */}
        <Route
          path="operational-settings"
          element={<AdminOperationalSettings />}
        />
      </Routes>
    </AdminLayout>
  );
}

// Application entry point
const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error(
    'Root element "#root" was not found in index.html.',
  );
}

createRoot(rootElement).render(
  <StrictMode>
    <RootErrorBoundary>
      <ThemeProvider
        attribute="class"
        defaultTheme="system"
        enableSystem
        disableTransitionOnChange
      >
      <BrowserRouter>
        <Suspense fallback={<RouteLoading />}>
          <Routes>
            {/* Public evidence image viewer */}
            <Route
              path="/evidence-image"
              element={<EvidenceImageViewer />}
            />
            {/* Temporary image testing pages */}
            {/* Sign-in page is the default homepage */}
            <Route
              path="/"
              element={<AuthPage redirectAfterAuth="/sales" />}
            />

            {/* Keep /auth as an alternative URL for sign-in */}
            <Route
              path="/auth"
              element={<AuthPage redirectAfterAuth="/sales" />}
            />

            {/* Sales — authentication required; no guest access */}
            <Route
              path="/sales/*"
              element={
                <RequireAuth role={USER_ROLES.SALES}>
                  <SalesRoutes />
                </RequireAuth>
              }
            />

            {/* Finance — Finance role required */}
            <Route
              path="/finance/*"
              element={
                <RequireAuth role={USER_ROLES.FINANCE}>
                  <FinanceRoutes />
                </RequireAuth>
              }
            />

            {/* HR — HR role required */}
            <Route
              path="/hr/*"
              element={
                <RequireAuth role={USER_ROLES.HR}>
                  <HrRoutes />
                </RequireAuth>
              }
            />

            {/* Admin — Admin role required */}
            <Route
              path="/admin/*"
              element={
                <RequireAuth role={USER_ROLES.ADMIN}>
                  <AdminRoutes />
                </RequireAuth>
              }
            />

            {/* Unknown URLs */}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </Suspense>

        <Toaster />
      </BrowserRouter>
      </ThemeProvider>
    </RootErrorBoundary>
  </StrictMode>,
);
