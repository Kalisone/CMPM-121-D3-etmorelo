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

#### D3.a Steps

- [x] copy main.ts to reference.ts for future reference & delete everything in main.ts
- [x] put a basic leaflet map on the screen
- [x] draw the player's location on the map
- [x] draw a whole grid of cells on the map
- [x] implement tokenspawning logic using deterministic hashing mechanism (see luck function in reference.ts)
- [x] render contents of each gridspace (token value or empty) with graphics or text
- [x] implement proximity & collection logic (clickhandlers with proxycheck)
- [x] give tokens different values
- [x] implement player inventory & inventory display system
- [x] implement crafting system: player combines 2 tokens of same value

### D3.b

Key technical challenge: Can you implement an interface with buttons to simulate local player movement?
Key gameplay challenge: Can players move around the map or scroll the map without moving the character while maintaining that only local cells be collected?

### D3.b Steps

- [x] implemented win condition: player has token of value x
- [] add basic directional buttons to the map interface.
- [] make buttons move player by 1 grid space
- [] add a free look button to allow player to choose whether the camera follows the player or moves freely

...
