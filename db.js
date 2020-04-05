const mysql = require("mysql");
const helpers = require("./helpers");

/**************
 * Connection *
 **************/

var db = mysql.createConnection({
  host: process.env.MYSQL_HOST || "localhost",
  user: process.env.MYSQL_USER || "cah-online",
  password: process.env.MYSQL_PASS || "password",
  database: process.env.MYSQL_DB || "cah-online"
});

db.connect((err) => {
  if (err) throw err;
  console.log("Connected to the MySQL Database!");
});

// Pass through the query method
exports.query = (sql, params, fn) => {
  db.query(sql, params, fn);
};

/*********
 * Users *
 *********/

exports.setUserIcon = (userId, icon) => {
  db.query(`UPDATE users SET icon = ? WHERE id = ?;`, 
  [icon, userId],(err, result) => {
    if (err) return console.warn("Failed to set icon for user #" + userId + ":", err);
    console.debug("Set icon for user #" + userId + " to '" + icon + "'");
  });
};

exports.setUserName = (userId, name) => {
  db.query(`UPDATE users SET name = ? WHERE id = ?;`, 
  [name, userId],(err, result) => {
    if (err) return console.warn("Failed to set name for user #" + userId + ":", err);
    console.debug("Set name for user #" + userId + " to '" + name + "'");
  });
};

exports.setUserState = (userId, state) => {
  db.query(`UPDATE users SET state = ? WHERE id = ?;`, 
  [state, userId],(err, result) => {
    if (err) return console.warn("Failed to set state for user #" + userId + ":", err);
    console.debug("Set state for user #" + userId + " to '" + state + "'");
  });
};

exports.addUserToRoom = (userId, roomId, state, fn=null) => {
  db.query(`UPDATE users SET room_id = ?, state = ? WHERE id = ?;`, [
    roomId,
    state,
    userId
  ], (err, result) => {
    if (err) {
      if (fn) fn({error: "MySQL Error"});
      return console.warn("Failed to add user #" + userId + " to room #" + roomId + ":", err);
    }
    console.debug("Added user #" + userId + " to room #" + roomId + " with state '" + state + "'");
    if (fn) fn({});
  });
};

/*********
 * Rooms *
 *********/

exports.getRoom = (roomId, fn) => {
  if (!roomId) return fn({error: "Room ID is required"});
  var sql = `
    SELECT token, edition, rotate_czar as rotateCzar, cur_prompt as curPrompt, state
    FROM rooms
    WHERE id = ?;
  `;
  db.query(sql, [
    roomId
  ],(err, results, fields) => {
    if (err) {
      console.warn("Failed to get room #" + roomId + ":", err);
      return fn({error: "MySQL Error"});
    } else if (results.length == 0) {
      return fn({error: "Invalid Room ID"});
    }
    fn({
      id: roomId,
      token: results[0].token,
      edition: results[0].edition,
      rotateCzar: results[0].rotateCzar,
      curPrompt: results[0].curPrompt,
      state: results[0].state
    });
  });
};

exports.getRoomWithToken = (roomId, token, fn) => {
  if (!helpers.validateHash(token, 8)) return fn({error: "Token is required"});
  exports.getRoom(roomId, room => {
    if (room.error) return fn(room);
    if (room.token != token) return fn({error: "Invalid Token"});
    return fn(room);
  });
};

exports.getRoomUsers = (roomId, fn) => {
  db.query(`SELECT id, name, icon, score, state FROM users WHERE room_id = ?;`, [
    roomId
  ],(err, results, fields) => {
    if (err) {
      console.warn("Failed to get users for room #" + roomId + ":", err);
      return fn({error: "MySQL Error"});
    }

    var roomUsers = {};
    var roomUserIds = [];

    // Convert arrays to objects (TODO: efficiency?)
    results.forEach(row => {
      roomUserIds.push(row.id);
      roomUsers[row.id] = {
        id: row.id,
        name: row.name,
        icon: row.icon,
        score: row.score,
        state: row.state
      };
    });
    fn({users: roomUsers, userIds: roomUserIds});
  });
};

exports.deleteRoom = (roomId) => {
  db.query(`DELETE FROM rooms WHERE id = ?;`, [
    roomId
  ], (err, result) => {
    if (err) return console.warn("Failed to delete room #" + roomId + ":", err);
    console.log("Deleted room #" + roomId);
  });
};

exports.deleteUser = (userId) => {
  db.query(`DELETE FROM users WHERE id = ?;`, [
    userId
  ], (err, result) => {
    if (err) return console.warn("Failed to delete user #" + userId + ":", err);
    console.log("Deleted user #" + userId);
  });
};

exports.setRoomState = (roomId, state, fn=null) => {
  db.query(`UPDATE rooms SET state = ? WHERE id = ?;`, 
  [state, roomId],(err, result) => {
    if (err) return console.warn("Failed to set state for room #" + roomId + ":", err);
    console.debug("Set state for room #" + roomId + " to '" + state + "'");
    if (fn) fn({});
  });
};

/********
 * Chat *
 ********/

exports.getLatestMessages = (roomId, limit, fn) => {
  var sql = `
    SELECT 
      msg.id, 
      msg.user_id AS userId, 
      msg.content, 
      msg.system_msg AS isSystemMsg, 
      GROUP_CONCAT(likes.user_id SEPARATOR ',') AS likes
    FROM messages msg
    LEFT JOIN message_likes likes ON msg.id = likes.message_id
    WHERE room_id = ?
    GROUP BY msg.id
    ORDER BY msg.id DESC
    LIMIT ?;`;
  db.query(sql, [
    roomId,
    limit
  ],(err, results, fields) => {
    if (err) {
      console.warn("Failed to get messages for room #" + roomId + ":", err);
      return fn({error: "MySQL Error"});
    }
    var roomMessages = {};

    results.forEach(row => {
      roomMessages[row.id] = {
        id: row.id,
        userId: row.userId,
        content: row.content,
        isSystemMsg: row.isSystemMsg,
        likes: row.likes ? row.likes.split(",") : []
      }
    });
    fn({messages: roomMessages});
  });  
};

exports.createMessage = (userId, content, isSystemMsg, fn) => {
  if (!helpers.validateString(content)) return fn({error: "Invalid Message"});
  content = helpers.stripHTML(content);

  db.query(`
    INSERT INTO messages (room_id, user_id, content, system_msg) 
    VALUES ((SELECT room_id FROM users WHERE id = ?), ?, ?, ?);
  `, [
    userId,
    userId,
    content,
    isSystemMsg
  ], (err, result) => {
    if (err) {
      console.warn("Failed to create message:", err);
      return fn({error: "MySQL Error"});
    }
    var msgId = result.insertId;

    // Create an object to represent the message on the client
    fn({
      id: msgId,
      userId: userId,
      content: content,
      isSystemMsg: isSystemMsg,
      likes: []
    });
  });
};

/*********
 * Cards *
 *********/

function getCardByID(id, black, fn) {
  var color = black ? "black" : "white";
  db.query(`SELECT * FROM ${color}_cards WHERE id = ?`, 
  [id], (err, results, fields) => {
    if (err) {
      console.warn("Failed to get " + color + " card #" + id + ":" + err);
      return fn({error: "MySQL Error"});
    } else if (results.length == 0) {
      return fn({error: "Invalid Card ID"});
    }
    return fn(results[0]);
  });
}

function getCards(roomId, black, count, fn) {
  if (!helpers.validateUInt(roomId)) return fn({error: "Invalid Room ID"});
  if (!helpers.validateUInt(count)) count = 1;
  var color = black ? "black" : "white";
  var sql = `
    SELECT *
    FROM ${color}_cards
    WHERE id IN (
      SELECT card_id 
      FROM ${color}_cards_link 
      WHERE edition IN (
        SELECT edition
        FROM rooms
        WHERE id = ${roomId}
      )
      UNION
      SELECT id
      FROM ${color}_cards
      WHERE pack IN (
        SELECT pack_id
        FROM room_packs
        WHERE room_id = ${roomId}
      )
    )
    AND id NOT IN (
      SELECT card_id
      FROM room_${color}_cards
      WHERE room_id = ${roomId}
    )
    ORDER BY RAND()
    LIMIT ${count};
  `;
  db.query(sql, (err, results, fields) => {
    if (err) {
      console.warn(`Failed to get ${color} card:`, err);
      return fn({error: "MySQL Error"});
    } else if (results.length == 0) return fn({error: "No cards left!"});
    return fn(results);
  });
}

exports.getBlackCard = (roomId, fn) => {
  getCards(roomId, true, 1, results => {
    if (results.error) return fn(results);
    fn({
      id: results[0].id,
      text: results[0].text,
      draw: results[0].draw,
      pick: results[0].pick
    });

    db.query(`INSERT INTO room_black_cards (card_id, room_id) VALUES (?, ?)`, 
    [ results[0].id, roomId ], (err, results) => {
      if (err) return console.warn("Failed to mark black card as used:", err);
    });

    db.query(`UPDATE rooms SET cur_prompt = ? WHERE id = ?`, 
    [ results[0].id, roomId ], (err, results) => {
      if (err) return console.warn("Failed to update prompt for room #" + roomId + ":", err);
    });
  });
};

exports.getBlackCardByID = (id, fn) => {
  getCardByID(id, true, card => {
    if (card.error) return fn(card);
    fn({
      id: card.id,
      text: card.text,
      draw: card.draw,
      pick: card.pick
    });
  });
};

exports.getWhiteCards = (roomId, userId, count, fn) => {
  if (!helpers.validateUInt(userId)) return fn({error: "Invalid User ID"});
  getCards(roomId, false, count, results => {
    if (results.error) return fn(results);

    var cards = {};
    var cardsSql = [];

    results.forEach(result => {
      cardsSql.push(`(${result.id}, ${roomId}, ${userId})`);
      if (count > 1) cards[result.id] = {id: result.id, text: result.text};
    });

    if (count == 1) fn({id: results[0].id, text: results[0].text });
    else fn(cards);

    // Prevent the chosen cards from being reused
    var sql = `INSERT INTO room_white_cards (card_id, room_id, user_id) VALUES `;
    db.query(sql + cardsSql.join(", ") + ";", (err, results) => {
      if (err) return console.warn("Failed to mark white card as used:", err);
    });
  });
};

exports.getWhiteCardByID = (id, fn) => {
  getCardByID(id, true, card => {
    if (card.error) return fn(card);
    fn({
      id: card.id,
      text: card.text
    });
  });
};