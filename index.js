const express = require("express");
const app = express();
require("dotenv").config();
const cors = require("cors");
const cookieParser = require("cookie-parser");
const bodyParser = require("body-parser");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const jwt = require("jsonwebtoken");
const stripe = require("stripe")(process.env.STRIPE_SECRECT_KEY);

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
  if (!token) {
    return res.status(401).send({ message: "unauthorized access" });
  }
  jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
    if (err) {
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
    const joinCampCollection = client.db("medcare").collection("join-camp");
    const paymentCollection = client.db("medcare").collection("payments");

    // auth related api
    app.post("/jwt", (req, res) => {
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
    app.get("/logout", (req, res) => {
      res
        .clearCookie("token", {
          maxAge: 0,
          secure: process.env.NODE_ENV === "production",
          sameSite: process.env.NODE_ENV === "production" ? "none" : "strict",
        })
        .send({ success: true });
    });

    // get user data from db
    app.put("/user", async (req, res) => {
      const user = req.body;
      const query = { email: user?.email };
      const isExist = await usersCollection.findOne({ email: user?.email });
      if (isExist) {
        if (user?.status === "Requested") {
          const result = await usersCollection.updateOne(query, {
            $set: { status: user?.status },
          });
          return res.send(result);
        } else {
          return res.send(isExist);
        }
      }
      const options = { upsert: true };
      const updateDoc = {
        $set: {
          ...user,
          timestamp: Date.now(),
        },
      };
      const result = await usersCollection.updateOne(query, updateDoc, options);
      res.send(result);
    });

    // get all users data from db
    app.get("/users", verifyToken, async (req, res) => {
      const result = await usersCollection.find().toArray();
      res.send(result);
    });

    // get a user info by email from db
    app.get("/user/:email", async (req, res) => {
      const email = req.params.email;
      const result = await usersCollection.findOne({ email });
      res.send(result);
    });

    // update a user role
    app.patch("/users/update/:email", async (req, res) => {
      const email = req.params.email;
      const user = req.body;
      const query = { email };
      const updateDoc = {
        $set: {
          ...user,
          timestamp: Date.now(),
        },
      };
      const result = await usersCollection.updateOne(query, updateDoc);
      res.send(result);
    });

    // save a camp data in db
    app.post("/camp", async (req, res) => {
      const campData = req.body;
      const result = await campCollection.insertOne(campData);
      res.status(200).send(result);
    });

    // get all camps
    app.get("/camps", async (req, res) => {
      const category = req.query.category;
      let query = {};
      if (category && category !== "null") query = { category };
      const result = await campCollection.find(query).toArray();
      res.status(200).send(result);
    });

    // data count from db for pagination
    app.get("/camps/counts", async (req, res) => {
      const filter = req.query.filter ? JSON.parse(req.query.filter) : {};
      const count = await campCollection.countDocuments(filter);
      res.status(200).send({ count });
    });

    // get pagination
    app.get("/camps/pagination", async (req, res) => {
      const size = parseInt(req.query.size) || 8;
      const page = parseInt(req.query.page) || 1;
      const category = req.query.category;
      let filter = {};
      if (category && category !== "null") {
        filter = { category };
      }
      const skip = (page - 1) * size;
      const camps = await campCollection
        .find(filter)
        .skip(skip)
        .limit(size)
        .toArray();
      const count = await campCollection.countDocuments(filter);
      res.status(200).send({ camps, count });
    });

    // get a single camp data from db using id
    app.get("/camp/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await campCollection.findOne(query);
      res.status(200).send(result);
    });

    // Stripe payment integration
    app.post("/create-payment-intent", async (req, res) => {
      try {
        const fees = req.body.price; 
        const priceInCent = parseFloat(fees * 100);
        if (!fees || priceInCent < 1) {
          return res.status(400).send({ error: "Invalid fees amount" });
        }
        const paymentIntent = await stripe.paymentIntents.create({
          amount: priceInCent,
          currency: "usd",
          automatic_payment_methods: {
            enabled: true,
          },
        });
        res.send({ clientSecret: paymentIntent.client_secret });
      } catch (error) {
        console.error("Error creating payment intent:", error);
        res.status(500).send({ error: error.message });
      }
    });

    app.post("/payments", async (req, res) => {
      try {
        const paymentData = req.body;
        const result = await paymentCollection.insertOne(paymentData);

        if (result.insertedId) {
          res.status(200).send(result);
        } else {
          res.status(500).send({ error: "Payment not inserted" });
        }
      } catch (error) {
        console.error("Error handling payment post:", error);
        res.status(500).send({ error: error.message });
      }
    });

    app.get("/payment/:email", verifyToken, async (req, res) => {
      const email = req.params.email;
      const query = { email: email };
      if (email !== req.decoded.email) {
        return res.status(403).send({ message: "forbidden access" });
      }
      const result = await paymentCollection.find(query).toArray();
      res.send(result);
    });

    // join camp and save user as participant
    app.post("/join-camp", verifyToken, async (req, res) => {
      try {
        const joinData = req.body;
        const email = req.user.email;

        const result = await joinCampCollection.insertOne(joinData);

        const updateUserResult = await usersCollection.updateOne(
          { email: email },
          { $set: { role: "participant" } }
        );
        res.status(200).send({
          success: true,
          message: "Joined camp successfully",
          result,
        });
      } catch (error) {
        console.error("Error joining camp:", error);
        res.status(500).send({
          success: false,
          message: "Error joining camp",
          error: error.message,
        });
      }
    });

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
