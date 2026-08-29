# ShuleHQ Admin Console — Missing Screens (Stitch generation prompts)

Stitch has already produced **11 core screens** (dashboard, subscriptions,
RBAC matrix, rollout, audit, backups, SMS, payment-history, academic-calendar,
changelog). These are the **9 screens still missing**. Generate each so it
**matches the existing 11** — same "Prestige Professional" system and shell.

---

## SHARED PREAMBLE — paste this ABOVE every screen prompt below
> Design a screen for the **ShuleHQ Super-Admin (operator) console**, matching my
> existing "Prestige Professional" admin screens exactly. **Design system:**
> Dark Slate `#2F3E46` primary, Polished Gold `#D4AF37` accent, slate-gray
> neutrals on off-white surfaces; success emerald, warning amber, error crimson,
> used sparingly. Serif headings (Source Serif), Inter for UI/body. Restrained,
> enterprise, institutional — no gradients, no glow, subtle depth, hairline
> borders, generous whitespace.
> **Shell (identical on every screen):** left dark-slate **collapsible sidebar**
> with the ShuleHQ Admin mark, and these nav items grouped by domain —
> *Overview:* Dashboard · *Institutions:* Tenants, Rollout Desk, Support ·
> *Billing:* Subscriptions (Billing, Plans, Groups, Assignments), Payment
> History, Academic Calendar · *Security:* RBAC (Permissions, Roles), Audit ·
> *System:* Backups, SMS, Changelog. Top bar with Cmd+K omni-search, notifications,
> help, and the operator avatar. Content area with a page title + subtitle,
> primary action top-right, then the screen body. Provide **desktop + a states
> note** (loading skeleton, empty, error). Data tables get a **Compact/Comfy
> density toggle** and a collapsible filter rail; row edits open a **right-hand
> slide-over panel**.

---

## 1. Tenant Management — `/saas/tenants`  ★ most important
Purpose: manage every school (tenant) on the platform.
- **Header:** "Tenant Management", subtitle "Every institution on the platform",
  primary button **Onboard Tenant**. A small KPI row: Total / Active / Inactive /
  New this month.
- **Table** (density toggle): columns — School (avatar + name + `slug`), Plan
  (badge), Status (Active / Inactive / **Demo**), Users, Curriculum (CBC/8-4-4),
  Created, Last activity, Actions (⋯).
- **Filter rail:** search, status, plan, curriculum.
- **Row slide-over ("Edit Tenant Profile"):** identity (name, slug, primary
  domain), plan & status, **Billing Eligibility Preview** + "first billing
  window" note, contact fields, Suspend/Activate, Save.
- States: skeleton rows; empty "No tenants onboarded yet".

## 2. Support Inbox — `/saas/support`
Purpose: triage prospect/support requests from the public site.
- **Header:** "Support Inbox", subtitle "Prospect & school requests", button **New**.
- **Two-pane layout:** left = request list (type badge — Demo / Enquiry /
  School-Visit — name, school, time, status dot New/Contacting/Scheduled/Closed);
  right = **detail pane** (full-name, school, email, phone, requested contact
  method, message/goal, status selector, internal notes, activity trail).
- Filters: type, status, search. States: empty "Inbox zero".

## 3. Subscription Billing — `/saas/subscriptions/billing`
Purpose: per-tenant subscription lifecycle (tab under Subscriptions).
- **Header:** "Subscription Management", tab bar (Billing · Plans · Groups ·
  Assignments), primary **New Subscription**.
- **Table:** Tenant (name + slug), Plan, Status (Active / Trialing / **Grace** /
  **Past due** / Cancelled — colored), Billing cycle (Per term / Per year),
  Current period, Amount (KES), Next renewal, Actions (Edit Subscription).
- Right-rail: "Current billing window" summary. Slide-over: edit subscription.
- States: past-due highlighted; empty state.

## 4. Plan Catalogue — `/saas/subscriptions/plans`
Purpose: define billing plans.
- **Header:** "Plan Catalogue", tab bar, primary **Create Plan**.
- **Plan cards or table:** Plan name, Price (KES) + cycle (per_term/per_year),
  included modules (chips), tenant count, active toggle, Edit / Delete.
- Slide-over form: name, price, cycle, modules multi-select, description.

## 5. Tenant Groups — `/saas/subscriptions/groups`  (multi-campus)
Purpose: group campuses under one institution.
- **Header:** "Tenant Groups", tab bar, primary **Create Group**.
- **List:** group name, # campuses, plan, actions Edit / Delete group.
- Expand/detail: member campuses (tenant chips) with **Attach campus** /
  **Detach campus**. Confirm dialogs for delete/detach.

## 6. Tenant Assignments — `/saas/subscriptions/tenants`
Purpose: assign tenants to plans/groups.
- **Header:** "Tenant Assignments", tab bar.
- **Table:** Tenant (name + slug), Current plan, Group, Status, Action **Assign**
  (slide-over: pick plan + group + effective date).
- Filters: unassigned / by plan / by group. Bulk-select + bulk assign.

## 7. Permission Catalog — `/saas/rbac/permissions`
Purpose: the platform-wide permission codes (feeds the RBAC matrix).
- **Header:** "Permission Catalog", subtitle "System-wide permission codes",
  primary **Create Permission**. Tabs link back to the RBAC **Matrix** and Roles.
- **Table:** Code (mono, e.g. `finance.invoices.read`), Description, Domain/
  category, # roles using it, Actions (Edit / Delete).
- Filter rail: search, domain. Slide-over: code, description, domain.

## 8. Role Catalog — `/saas/rbac/roles`
Purpose: global role templates directors can assign.
- **Header:** "Role Catalog", primary **Create Role**. Tabs: Matrix · Permissions · Roles.
- **Table/cards:** Role name, code, # permissions, assignable (yes/no),
  description, Actions (Edit → opens permission picker / links to matrix).
- Slide-over: role name, code, description, permission multi-select.

## 9. Receipt Verification — `/saas/verify-receipt`  (utility)
Purpose: verify a payment receipt by code/token.
- **Centered card:** "Receipt Verification", input for receipt code/token,
  **Verify** button. On success: receipt details (tenant, amount KES, date,
  status, M-Pesa reference) with a green Verified state; on failure: clear
  invalid/not-found state. Minimal, single-column utility layout.

---

### Notes
- `/saas/users` referenced from the dashboard **has no route** — it's a dead link;
  platform users are managed via Tenants + RBAC. Either drop that dashboard link
  or we build a real Users screen later — no Stitch screen needed now.
- Generate **desktop** first (the console is desktop-primary); a mobile pass can
  follow.
- Keep every screen on the **shared shell + nav** above so the console feels like
  one product, not 20 pages.
