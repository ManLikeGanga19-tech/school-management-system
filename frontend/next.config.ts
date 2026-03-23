import type { NextConfig } from "next";
import os from "os";
import path from "path";
import fs from "fs";

// Use a safe build output dir when running inside OneDrive on Windows to
// avoid EBUSY / file-lock errors caused by cloud sync locking files during
// development. When detected, place Next's build output in the OS temp dir.
const cwd = process.cwd();
let distDir = ".next";
try {
  const isWindows = process.platform === "win32";
  const inOneDrive = typeof cwd === "string" && /OneDrive/i.test(cwd);
  if (isWindows && inOneDrive) {
    const name = `smm-frontend-next-${process.cwd().split(path.sep).pop() || "build"}`;
    const tempTarget = path.join(os.tmpdir(), name);

    // Ensure the temp target exists
    try {
      if (!fs.existsSync(tempTarget)) {
        fs.mkdirSync(tempTarget, { recursive: true });
      }
    } catch (err) {
      // ignore - best effort
    }

    // Create a node_modules junction inside the temp target that points back
    // to the project's node_modules so requires from the temp dir resolve.
    try {
      const projectNodeModules = path.join(process.cwd(), "node_modules");
      const targetNodeModules = path.join(tempTarget, "node_modules");
      if (!fs.existsSync(targetNodeModules) && fs.existsSync(projectNodeModules)) {
        try {
          fs.symlinkSync(projectNodeModules, targetNodeModules, "junction");
        } catch (e) {
          // ignore symlink errors (best-effort)
        }
      }
    } catch (err) {
      // best effort
    }

    // Create a project-local junction `.next-temp` that points to the temp target.
    // Using a junction avoids requiring elevated privileges on Windows.
    const linkPath = path.join(process.cwd(), ".next-temp");
    try {
      const linkExists = fs.existsSync(linkPath);
      if (!linkExists) {
        // create junction
        fs.symlinkSync(tempTarget, linkPath, "junction");
      }
      distDir = ".next-temp";
      // eslint-disable-next-line no-console
      console.warn(`NextJS distDir moved to .next-temp (junction -> ${tempTarget}) to avoid OneDrive locking`);
    } catch (err) {
      // Fallback: use the temp target directly if we couldn't create a junction
      distDir = tempTarget;
      // eslint-disable-next-line no-console
      console.warn(`NextJS distDir fallback to temp to avoid OneDrive locking: ${distDir}`);
    }
  }
} catch (err) {
  // best-effort only; fall back to default
}

const nextConfig: NextConfig = {
  // Keep the React Compiler opt-in only. It is still experimental and adds
  // unnecessary build cost for our current release pipeline.
  reactCompiler: process.env.NEXT_ENABLE_REACT_COMPILER === "true",
  distDir,
  output: "standalone",

  // next-intl requires the request config to be resolvable as "next-intl/config".
  // createNextIntlPlugin injects this alias via webpack but also adds
  // experimental.turbo which is invalid in Next.js 16, breaking Turbopack.
  // We configure both bundlers manually instead.

  // Turbopack (Next.js 16 default — `npm run dev:turbo`)
  turbopack: {
    resolveAlias: {
      "next-intl/config": "./src/i18n/request.ts",
    },
  },

  // Webpack (`npm run build` and `npm run dev`)
  webpack(config) {
    config.resolve.alias = {
      ...config.resolve.alias,
      "next-intl/config": path.resolve("./src/i18n/request.ts"),
    };
    return config;
  },
};

export default nextConfig;
