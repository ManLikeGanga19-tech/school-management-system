"use client";

// Re-export from the custom toast system so all existing `import { toast } from "@/components/ui/sonner"`
// calls pick up the new implementation without changing any callsites.
export { toast, ToastContainer as Toaster } from "@/components/ui/toast";
