import { MirasimAuthPlugin } from "opencode-mirasim-auth"
import { adapt } from "./adapter.mjs"

export default async function mirasimGPT(input) {
  return adapt(input, MirasimAuthPlugin)
}
