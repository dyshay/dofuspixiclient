import type { LinguiConfig } from "@lingui/conf";

const config: LinguiConfig = {
  sourceLocale: "fr",
  locales: ["fr"],
  catalogs: [
    {
      path: "src/lib/i18n/locales/{locale}",
      include: ["src"],
    },
  ],
};

export default config;
