// SPDX-License-Identifier: MIT

import { defineBrand } from "../shared/brand";

const brand = defineBrand({
  brandApi: 1,
  name: "Flarebot",
  logo: { light: "./assets/logo.svg", dark: "./assets/logo.svg" },
  motion: "crisp",
  links: { source: "https://github.com/p-sw/flarebot" },
});

export default brand;
