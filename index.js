const express = require("express");
const app = express();
require("dotenv").config();
const cors = require("cors");
const cookieParser = require("cookie-parser");
const bodyParser = require("body-parser");
const { MongoClient, ServerApiVersion } = require("mongodb");
const jwt = require("jsonwebtoken");

const port = process.env.PORT || 5000;

// middleware
const corsOptions = {
  origin: ["http://localhost:5173", "http://localhost:5174"],
  credentials: true,
  optionSuccessStatus: 200,
};
app.use(cors(corsOptions));

app.use(express.json());
app.use(cookieParser());
app.use(express.static("public"));
app.use(bodyParser.json());

// Verify Token Middleware
const verifyToken = (req, res, next) => {
  const token = req.cookies?.token;
  console.log(token);
  if (!token) {
    return res.status(401).send({ message: "unauthorized access" });
  }
  jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
    if (err) {
      console.log(err);
      return res.status(401).send({ message: "unauthorized access" });
    }
    req.user = decoded;
    next();
  });
};



const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.cibrnya.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    await client.connect();
    const usersCollection = client.db("medcare").collection("users");
    const campCollection = client.db("medcare").collection("camps");

    // auth related api
    app.post("/jwt", async (req, res) => {
      const user = req.body;
      const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, {
        expiresIn: "365d",
      });
      res
        .cookie("token", token, {
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          sameSite: process.env.NODE_ENV === "production" ? "none" : "strict",
        })
        .send({ success: true });
    });

    // Logout
    app.get("/logout", async (req, res) => {
      try {
        res
          .clearCookie("token", {
            maxAge: 0,
            secure: process.env.NODE_ENV === "production",
            sameSite: process.env.NODE_ENV === "production" ? "none" : "strict",
          })
          .send({ success: true });
        console.log("Logout successful");
      } catch (err) {
        res.status(500).send(err);
      }
    });

    app.post("/save-user", async (req, res) => {
      try {
        const { uid, email, displayName, photoURL } = req.body;
        if (!uid || !email) {
          throw new Error("Missing required fields");
        }

        console.log("Received data:", { uid, email, displayName, photoURL });

        const userDoc = {
          uid,
          email,
          displayName,
          photoURL,
          role: "participants",
        };

        await usersCollection.updateOne(
          { uid: userDoc.uid },
          { $set: userDoc },
          { upsert: true }
        );

        res.status(200).send({ message: "User saved successfully" });
      } catch (error) {
        console.log("Error in /save-user:", error);
        res.status(500).send({ message: "Error saving user" });
      }
    });

    // save a camp data in db
    app.post('/camp', async (req, res) => {
      const campData = req.body;
      const result = await campCollection.insertOne(campData)
      res.status(200).send(result)
    })

    // get all camps
    app.get('/camps', async (req, res) => {
      const category = req.params.category;
      let query = {};
      if (category && category !== "null") query = { category };
      const result = await campCollection.find(query).toArray();
      res.status(200).send(result)
        
    })


    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } catch (error) {
    console.log("Error connecting to MongoDB:", error);
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("MedCare!");
});

app.listen(port, () => {
  console.log(`MedCare is running on port ${port}`);
});
