# D3: World of Bits

## Game Design Vision

This game will use Leaflet to render an interactive map centered to the location of the player. Players will move around the real world, searching for, collecting, & depositing items in locations that can only be interacted with by proximity. These items will represent tokens with certain values. Players should be able to combine two tokens of the same value to create a new one of twice the value. This game should be supported on mobile & gameplay should be supported across browser sessions.

## Technologies

- TypeScript for most game code, little to no explicit HTML, and all CSS collected in common `style.css` file
- Deno and Vite for building
- GitHub Actions + GitHub Pages for deployment automation

## Assignments

### D3.a: Core mechanics (token collection and crafting)

Key technical challenge: Can you assemble a map-based user interface using the Leaflet mapping framework?
Key gameplay challenge: Can players collect and craft tokens from nearby locations to finally make one of sufficiently high value?

#### Steps

- [x] copy main.ts to reference.ts for future reference & delete everything in main.ts
- [x] put a basic leaflet map on the screen
- [x] draw the player's location on the map
- [x] draw a whole grid of cells on the map
- [x] implement tokenspawning logic using deterministic hashing mechanism (see luck function in reference.ts)
- [x] render contents of each gridspace (token value or empty) with graphics or text
- [ ] implement proximity & collection logic (clickhandlers with proxycheck)
- [ ] give tokens different values
- [ ] implement player inventory & inventory display system
- [ ] implement crafting system: player combines 2 tokens of same value

### D3.b

...
