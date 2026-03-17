const config = {
  sourceLocale: "fr",
  locales: ["fr"],
  catalogs: [
    {
      path: "src/lib/i18n/locales/{locale}",
      include: ["src"],
    },
  ],
} as const;

export default config;
