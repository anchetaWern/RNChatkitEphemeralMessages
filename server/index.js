const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const Chatkit = require("@pusher/chatkit-server");
const crypto = require("crypto");

require("dotenv").config();
const app = express();

const CHATKIT_INSTANCE_LOCATOR_ID = process.env.CHATKIT_INSTANCE_LOCATOR_ID;;
const CHATKIT_SECRET_KEY = process.env.CHATKIT_SECRET_KEY;
const CHATKIT_WEBHOOK_SECRET = process.env.CHATKIT_WEBHOOK_SECRET;

const chatkit = new Chatkit.default({
  instanceLocator: CHATKIT_INSTANCE_LOCATOR_ID,
  key: CHATKIT_SECRET_KEY
});

app.use(bodyParser.urlencoded({ extended: false }));
app.use(cors());

app.use(
  bodyParser.text({
    type: (req) => {
      const user_agent = req.headers['user-agent'];
      if (user_agent === 'pusher-webhooks') {
        return true;
      }
      return false;
    },
  })
);

app.use(
  bodyParser.json({
    type: (req) => {
      const user_agent = req.headers['user-agent'];
      if (user_agent !== 'pusher-webhooks') {
        return true;
      }
      return false;
    }
  })
);

const verifyRequest = (req) => {
  const signature = crypto
    .createHmac("sha1", CHATKIT_WEBHOOK_SECRET)
    .update(req.body)
    .digest("hex")

  return signature === req.get("webhook-signature")
}

app.post("/user", async (req, res) => {
  const { username } = req.body;
  try {
    const users = await chatkit.getUsers();
    const user = users.find((usr) => usr.name == username);
    res.send({ user });
  } catch (get_user_err) {
    console.log("error getting user: ", get_user_err);
  }
});

app.post("/rooms", async (req, res) => {
  const { user_id } = req.body;
  try {
    const rooms = await chatkit.getUserRooms({
      userId: user_id
    });
    rooms.map((item) => {
      item.joined = true;
      return item;
    });

    const joinable_rooms = await chatkit.getUserJoinableRooms({
      userId: user_id
    });
    joinable_rooms.map((item) => {
      item.joined = false;
      return item;
    });

    const all_rooms = rooms.concat(joinable_rooms);

    res.send({ rooms: all_rooms });
  } catch (get_rooms_err) {
    console.log("error getting rooms: ", get_rooms_err);
  }
});

app.post("/user/join", async (req, res) => {
  const { room_id, user_id } = req.body;
  try {
    await chatkit.addUsersToRoom({
      roomId: room_id,
      userIds: [user_id]
    });

    res.send('ok');
  } catch (user_permissions_err) {
    console.log("error getting user permissions: ", user_permissions_err);
  }
});

app.post('/delete-message', async(req, res) => {
  const { room_id, message_id } = req.body;
  const delay = 60 * 10000; // 1 minute
  try {
    setTimeout(async () => {

      await chatkit.deleteMessage({
        roomId: room_id,
        id: message_id
      });

    }, delay);

  } catch (err) {
    console.log('err: ', err);
  }
  res.send('ok');
});


const message_expire_setting = async (room_id) => {
  try {
    const room = await chatkit.getRoom({
      roomId: room_id,
    });

    return room.custom_data.messages_expire_in;
  } catch (err) {
    console.log('err: ', err);
  }
}


app.post('/ephemeral', async (req, res) => {

  try {
    if (verifyRequest(req)) {
      const { payload } = JSON.parse(req.body);

      const message = payload.messages[0];
      const room_id = message.room_id;
      const message_id = message.id;

      const expire_in = await message_expire_setting(room_id);
      if (expire_in == 'expire_3_mins') {
        const delay = 60 * 3 * 1000; // 3 minutes
        setTimeout(async () => {
          await chatkit.deleteMessage({
            roomId: room_id,
            messageId: message_id
          });
        }, delay);
      }

    }
  } catch (err) {
    console.log('webhook error: ', err);
  }

  res.send('ok');
});

app.post('/update-room', async (req, res) => {

  const { room_id, setting } = req.body;
  try {
    await chatkit.updateRoom({
      id: room_id,
      customData: {
        'messages_expire_in': setting
      }
    });

    res.send('ok');
  } catch (err) {
    console.log('error updating room: ', err);
  }
});


const PORT = 5000;
app.listen(PORT, (err) => {
  if (err) {
    console.error(err);
  } else {
    console.log(`Running on ports ${PORT}`);
  }
});