const Phaser = require('phaser');
const path = require('path');

// Load input settings and build a reverse lookup table
const inputsSettings = require(path.join(__dirname, 'data/settings/inputs.json'));
const inputsTable = (() => {
    let table = {};
    inputsSettings.forEach(a => {
        a.keys.forEach(b => {
            table[b] = a.id;
        });
    });
    console.log("Input reverse lookup table", table);
    return table;
})();

// Simple math lambda functions
const clamp = (n, min, max) => n < min ? min : n > max ? max : n,
      min = (a, b) => b < a ? b : a,
      max = (a, b) => b > a ? b : a;

// Compose color in a single integer (e.g. 0xFFEEDD)
const colorCompose = (red, green, blue) => {
    let c = clamp(blue, 0, 255);
    c += clamp(green, 0, 255) << 8;
    c += clamp(red, 0, 255) << 16;
    return c;
};


class Player
{
    constructor(sprite)
    {
        this.sprite = sprite;
        this.sprite.setCollideWorldBounds(true);
        this.sprite.tint = 0x00abcd;

        this.moveUp = false;
        this.moveRight = false;
        this.moveDown = false;
        this.moveLeft = false;

        this.moveSpeed = 100;
        this.jumpForce = 150;
    }

    move()
    {
        let direction = {x:0, y:0};

        if (this.moveUp)
            direction.y -= 1;
        if (this.moveRight)
            direction.x += 1;
        if (this.moveDown)
            direction.y += 1;
        if (this.moveLeft)
            direction.x -= 1;

        // Normalize direction vector
        let length = Math.sqrt(direction.x * direction.x + direction.y * direction.y);
        if (length === 0) length = 1;
        direction.x /= length;
        direction.y /= length;

        // Catch error on physics system unloaded while moving during a scene change
        try
        {
            this.sprite.setVelocityX(direction.x * this.moveSpeed);

            if (direction.y < 0 && this.sprite.body.touching.down)
                this.sprite.setVelocityY(this.jumpForce * -1);
        }
        catch (e)
        {}
    }
}


let levelIndex = '1';
class LevelScene extends Phaser.Scene
{
    constructor()
    {
        super('level');

        this.description = null;
        this.player = null;
    }

    preload()
    {
        // Load the level description file
        this.description = require(path.join(__dirname, `data/scenes/${levelIndex}.json`));

        // Load level assets
        this.description.assets.forEach(o => {
            if (this.textures.exists(o.id))
                this.textures.remove(o.id);

            switch (o.type)
            {
                case 'image':
                    this.load.image(o.id, path.join(__dirname, o.path));
                    console.log(`Image ${o.id} loaded`);
                    break;

                // No other asset type for now
                default:
                    break;
            }
        });
    }

    create()
    {
        // Bind keyboard events to handler
        this.input.keyboard.on('keydown', event => this.inputHandler(this.scene, event, true));
        this.input.keyboard.on('keyup', event => this.inputHandler(this.scene, event, false));

        //  Object groups
        let blocks = this.physics.add.staticGroup();
        let doors = this.physics.add.staticGroup();
        let ghosts = this.physics.add.staticGroup();
        let keys = this.physics.add.group();

        // Object and interaction lookup tables
        let objectTable = {};
        let interactionsTable = {};

        // Setup level according to the description file
        this.description.elements.forEach(o => {
            switch (o.type)
            {
                case 'player':
                    let x = o.coordinates.x,
                        y = o.coordinates.y;
                    this.player = new Player(this.physics.add.image(x, y, o.sprite));
                    break;

                case 'sprite':

                    let s = this.physics.add.image(o.coordinates.x, o.coordinates.y, o.sprite);
                    s.tint = colorCompose(o.color.red, o.color.green, o.color.blue);

                    switch (o.function)
                    {
                        case "key":
                            keys.add(s);
                            break;
                        default:
                            ghosts.add(s);
                            break;
                    }

                    if (o.id)
                    {
                        objectTable[o.id] = {desc: o, obj: s};
                        s.id = o.id;
                    }
                    break;

                case 'rect':
                    // Setup rect properties from the coordinates
                    let xmin = min(o.coordinates.x1, o.coordinates.x2),
                        ymin = min(o.coordinates.y1, o.coordinates.y2),
                        xmax = max(o.coordinates.x1, o.coordinates.x2),
                        ymax = max(o.coordinates.y1, o.coordinates.y2);
                    let rect = {
                        x: xmin,
                        y: ymin,
                        w: xmax - xmin,
                        h: ymax - ymin
                    }

                    // Draw rect
                    let r = this.add.rectangle(rect.x, rect.y, rect.w, rect.h,
                                               colorCompose(o.color.red, o.color.green, o.color.blue),
                                               clamp(o.color.alpha, 0, 1));
                    r.setOrigin(0,0);

                    switch (o.function)
                    {
                        case 'wall':
                            blocks.add(r);
                            break;
                        case 'door':
                            doors.add(r);
                            r.levelIndex = o.levelIndex;
                            break;
                        default:
                            ghosts.add(r);
                            break;
                    }

                    if (o.id)
                    {
                        objectTable[o.id] = {desc: o, obj: r};
                        r.id = o.id;
                    }
                    break;

                default:
                    break;
            }
        });

        // Build interaction lookup table
        this.description.interactions.forEach(o => {
            interactionsTable[o.trigger] = {target: o.target, action: o.action};

            let target = objectTable[o.target];
            switch (o.action)
            {
                case "enable":
                    target.obj.alpha /= 2;
                    target.obj.setActive(false);
                    target.obj.body.enable = false;
                    break;

                case "disable":
                default:
                    break;
            }
        });

        this.physics.add.collider(this.player.sprite, blocks);
        this.physics.add.collider(keys, blocks);
        this.physics.add.overlap(
            this.player.sprite,
            doors,
            (player, door) => {
                levelIndex = door.levelIndex;
                this.scene.restart();
            }
        );
        this.physics.add.overlap(
            this.player.sprite,
            keys,
            (player, key) => {
                let interaction = interactionsTable[key.id];
                let target = objectTable[interaction.target];

                // Remove key object
                key.destroy();

                console.log(interaction);
                switch (interaction.action)
                {
                    case "enable":
                        target.obj.alpha = target.desc.color.alpha;
                        target.obj.setActive(true);
                        target.obj.body.enable = true;
                        break;

                    case "disable":
                        target.obj.alpha /= 2;
                        target.obj.setActive(false);
                        target.obj.body.enable = false;
                        break;

                    default:
                        break;
                }
            }
        );

        // Disable physics on ghost objects
        ghosts.children.entries.forEach(o => o.body.enable = false);
    }

    update(time, delta)
    {
        this.player.move();
    }

    inputHandler(sceneObject, keyboardEvent, keyDown)
    {
        // Log key code if you need it
        // console.log(keyboardEvent.code);

        // If input is defined in settings, then continue
        let input = inputsTable[keyboardEvent.code];
        if (input)
        {
            switch (input)
            {
                case 'quit':
                    // debug key, close window
                    if (keyDown)
                    {
                        require('electron').remote.getCurrentWindow().close();
                    }
                    break;
                case 'reloadLevel':
                    // debug key, reload level, don't alter level index
                    if (keyDown)
                    {
                        console.log('Restarting current level');
                        sceneObject.restart();
                    }
                    break;

                case 'up':
                    this.player.moveUp = keyDown;
                    break;
                case 'right':
                    this.player.moveRight = keyDown;
                    break;
                // case 'down':
                    // this.player.moveDown = keyDown;
                    // break;
                case 'left':
                    this.player.moveLeft = keyDown;
                    break;
            }
        }
    }
}


// Start game
new Phaser.Game({
    type: Phaser.AUTO,
    width: 800,
    height: 600,
    transparent: false,
    backgroundColor: 'rgb(247,247,247)',
    scene: [ LevelScene ],
    physics: {
        default: 'arcade',
        arcade:
            {
                gravity:
                    {
                        x: 0,
                        y: 100
                    },
                debug: false
            }
    },
    title: "Not-so-generic Generic Platformer",
    version: "1.0.0"
});


// Debug functions
const setLevelIndex = index => levelIndex = index;