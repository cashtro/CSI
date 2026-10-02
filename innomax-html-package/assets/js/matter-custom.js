function initSimulation() {
  const {
    Engine,
    Render,
    Events,
    MouseConstraint,
    Mouse,
    World,
    Bodies,
  } = Matter;
 
  const engine = Engine.create();
  const world = engine.world;
 
  const container = document.querySelector(".tags-container");
  const width = container.clientWidth;
  const height = container.clientHeight;
 
  const render = Render.create({
    element: container,
    engine,
    options: {
      width,
      height,
      pixelRatio: 2,
      background: "transparent",
      wireframes: false
    }
  });
 
  Render.run(render);
  Engine.run(engine);
 
  // Walls
  const wallThickness = 160;
  const ground = Bodies.rectangle(width / 2, height + wallThickness / 2, width + 320, wallThickness, { isStatic: true });
  const wallLeft = Bodies.rectangle(-wallThickness / 2, height / 2, wallThickness, height, { isStatic: true });
  const wallRight = Bodies.rectangle(width + wallThickness / 2, height / 2, wallThickness, height, { isStatic: true });
  const roof = Bodies.rectangle(width / 2, -wallThickness / 2, width + 320, wallThickness, { isStatic: true });
 
  World.add(world, [ground, wallLeft, wallRight, roof]);
 
  // 19 Sprites
  const radius = 20;
  const tags = [];
  for (let i = 1; i <= 19; i++) {
    tags.push(
      Bodies.rectangle(
        width / 2 + Math.random() * 200 - 100,
        200 + i * 10,
        200,
        56,
        {
          chamfer: { radius },
          render: {
            sprite: {
              texture: `/assets/img/mattericon/t${i}.png`,
              xScale: 1,
              yScale: 1
            }
          }
        }
      )
    );
  }
 
  World.add(world, tags);
 
  // Mouse interaction
  const mouse = Mouse.create(render.canvas);
  const mouseConstraint = MouseConstraint.create(engine, {
    mouse,
    constraint: {
      stiffness: 0.2,
      render: { visible: false }
    }
  });
 
  World.add(world, mouseConstraint);
  render.mouse = mouse;
 
  // Disable scroll hijacking
  mouse.element.removeEventListener("mousewheel", mouse.mousewheel);
  mouse.element.removeEventListener("DOMMouseScroll", mouse.mousewheel);
}
 
// Auto-run only once when .tags-container becomes visible
const container = document.querySelector(".tags-container");
if (container) {
  container.innerHTML = ""; // clean before render
 
  const observer = new IntersectionObserver((entries, observer) => {
    if (entries[0].isIntersecting) {
      initSimulation();
      observer.disconnect();
    }
  });
 
  observer.observe(container);
}