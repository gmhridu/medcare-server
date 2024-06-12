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
const verifyToken = async (req, res, next) => {
  const token = req.cookies?.token;
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

    // verify organizer middleware
    const verifyOrganizer = async (req, res, next) => {
      const user = req.user;
      const query = { email: user?.email };
      const result = await usersCollection.findOne(query);
      if (!result || result?.role !== "organizer") {
        return res.status(401).send({ message: "unauthorized access" });
      }
      next();
    };

    // verify participant middleware

    const verifyParticipant = async (req, res, next) => {
      const user = req.user;
      const query = { email: user?.email };
      const result = await usersCollection.findOne(query);
      if (!result || result?.role !== "participant") {
        return res.status(401).send({ message: "unauthorized access" });
      }
      next();
    };

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

    app.get("/camps/organizer/:email", verifyToken, verifyOrganizer, async (req, res) => {
      const organizerEmail = req.params.email;

      if (organizerEmail !== req.user.email) {
        return res.status(403).send({ message: "forbidden access" });
      }
      try {
        const query = { "organizer.email": organizerEmail };
        const result = await campCollection.find(query).toArray();
        res.status(200).send(result);
      } catch (error) {
        console.error("Error fetching camps by organizer email:", error);
        res.status(500).send({ error: error.message });
      }
    });

    // edit camp details
    app.put("/camp/update/:id", verifyToken, verifyOrganizer, async (req, res) => {
      const id = req.params.id;
      const { name, location, fees, healthcareProfessional, dateTime } =
        req.body;

      const query = { _id: new ObjectId(id) };
      const updateDoc = {
        $set: {
          name,
          location,
          fees,
          healthcareProfessional,
          dateTime,
          timestamp: Date.now(),
        },
      };
      const result = await campCollection.updateOne(query, updateDoc);
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

    // delete a camp from db
    app.delete("/camp/:id", verifyToken, verifyOrganizer, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await campCollection.deleteOne(query);
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

    // save payments in db
    app.post("/payments", async (req, res) => {
      try {
        const paymentData = req.body;
        if (paymentData._id) {
          delete paymentData._id;
        }

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

    // get all payments from db
    app.get("/payment", verifyToken, async (req, res) => {
      const result = await paymentCollection.find().toArray();
      res.send(result);
    });

    // find payment by user email
    app.get("/payments/:email", verifyToken, verifyParticipant, async (req, res) => {
      const email = req.params.email;
      if (email !== req.user.email) {
        return res.status(403).send({ message: "forbidden access" });
      }
      const query = { email: email };
      const result = await paymentCollection.find(query).toArray();
      res.send(result);
    });

    // delete a payment by paymentMethodId
    app.delete("/payments/:paymentMethodId", verifyToken, async (req, res) => {
      try {
        const paymentMethodId = req.params.paymentMethodId;
        const query = { paymentMethodId: paymentMethodId };
        const result = await paymentCollection.deleteOne(query);
        res.status(200).send(result);
      } catch (error) {
        console.error("Error deleting payment:", error);
        res.status(500).send({ error: error.message });
      }
    });

    // delete a camp
    app.delete("/camp/:id", verifyToken, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await campCollection.deleteOne(query);
      res.status(200).send(result);
    });

    // search
    app.get("/search", async (req, res) => {
      try {
        const { name, date, healthcareProfessional, category } = req.query;

        let query = {};
        if ((name, date, healthcareProfessional, category)) {
          query.name = { $regex: new RegExp(name, "i") };
        }
        if (date) {
          query.dateTime = new Date(date);
        }
        if (healthcareProfessional) {
          query["healthcareProfessional.name"] = {
            $regex: new RegExp(healthcareProfessional, "i"),
          };
        }
        if (category && category !== "null") {
          query.category = category;
        }

        const result = await campCollection.find(query).toArray();
        res.status(200).send(result);
      } catch (error) {
        console.error("Error searching camps:", error);
        res.status(500).send({ error: error.message });
      }
    });

    // join camp and save user as participant
    const { ObjectId } = require("mongodb");

    app.post("/join-camp", verifyToken, async (req, res) => {
      try {
        const joinData = req.body;
        const email = req.user.email;

        if (!email) {
          return res
            .status(400)
            .send({ success: false, message: "Email is required" });
        }

        const campId = joinData.campId;

        if (!ObjectId.isValid(campId)) {
          return res
            .status(400)
            .send({ success: false, message: "Invalid camp ID" });
        }

        const objectIdCampId = new ObjectId(campId);
        const existingCamp = await campCollection.findOne({
          _id: objectIdCampId,
        });

        if (!existingCamp) {
          console.log(`Camp with ID ${campId} not found.`);
          return res
            .status(404)
            .send({ success: false, message: "Camp not found" });
        }

        let participantCount = existingCamp.participantCount || 0;
        participantCount++;

        const updateCampResult = await campCollection.updateOne(
          { _id: objectIdCampId },
          { $set: { participantCount } }
        );

        if (updateCampResult.modifiedCount !== 1) {
          console.error(
            "Failed to update camp participant count:",
            updateCampResult
          );
          return res.status(500).send({
            success: false,
            message: "Failed to update camp participant count",
          });
        }

        const joinCampResult = await joinCampCollection.insertOne(joinData);

        if (!joinCampResult.acknowledged || !joinCampResult.insertedId) {
          console.error("Failed to insert join camp data:", joinCampResult);
          return res.status(500).send({
            success: false,
            message: "Failed to insert join camp data",
          });
        }

        const user = await usersCollection.findOne({ email: email });
        if (user.role !== "participant") {
          const updateUserResult = await usersCollection.updateOne(
            { email: email },
            { $set: { role: "participant" } }
          );

          if (updateUserResult.modifiedCount !== 1) {
            console.error("Failed to update user role:", updateUserResult);
            return res
              .status(500)
              .send({ success: false, message: "Failed to update user role" });
          }
        }

        res.status(200).send({
          success: true,
          message: "Joined camp successfully",
          joinCampResult,
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

    app.get("/joinCamp", async (req, res) => {
      const result = await joinCampCollection.find().toArray();
      res.send(result);
    });

    app.get("/join-camps/:email", verifyToken, async (req, res) => {
      const email = req.params.email;
      if (email !== req.user.email) {
        return res.status(403).send({ message: "forbidden access" });
      }
      const query = { email: email };
      const result = await joinCampCollection.find(query).toArray();
      res.send(result);
    });

    app.patch(
      "/payments/cancel/:paymentMethodId",
      verifyToken,
      async (req, res) => {
        const paymentMethodId = req.params.paymentMethodId;

        try {
          const joinCampUpdateResult = await joinCampCollection.updateOne(
            { paymentMethodId: paymentMethodId },
            { $set: { status: "Canceled" } }
          );

          const paymentUpdateResult = await paymentCollection.updateOne(
            { paymentMethodId: paymentMethodId },
            { $set: { status: "Canceled" } }
          );

          if (
            joinCampUpdateResult.modifiedCount > 0 &&
            paymentUpdateResult.modifiedCount > 0
          ) {
            res
              .status(200)
              .send({ message: "Payment and camp status updated to Canceled" });
          } else {
            res.status(404).send({ message: "Payment method not found" });
          }
        } catch (error) {
          console.error("Error canceling payment:", error);
          res.status(500).send({ error: error.message });
        }
      }
    );

    app.patch("/join-camp/rate/:id", verifyToken, async (req, res) => {
      const id = req.params.id;
      const { rating, ratingText } = req.body;

      if (!rating || rating < 1 || rating > 5) {
        return res.status(400).send({ message: "Invalid rating value" });
      }

      try {
        const query = {
          _id: new ObjectId(id),
          participantEmail: req.user.email,
        };
        const updateDoc = {
          $set: {
            rating: rating,
            ratingText: ratingText || "",
          },
        };
        const result = await joinCampCollection.updateOne(query, updateDoc);

        if (result.modifiedCount > 0) {
          const joinCampEntry = await joinCampCollection.findOne(query);
          const campId = joinCampEntry.campId;

          // Fetch all ratings for the camp
          const allRatings = await joinCampCollection
            .find({ campId: campId, rating: { $exists: true } })
            .toArray();

          // Calculate the new average rating
          const totalRatings = allRatings.reduce(
            (acc, item) => acc + item.rating,
            0
          );
          const averageRating = totalRatings / allRatings.length;

          const campQuery = { _id: new ObjectId(campId) };
          const campUpdateDoc = {
            $set: { averageRating: averageRating },
          };
          await campCollection.updateOne(campQuery, campUpdateDoc);

          res
            .status(200)
            .send({ message: "Rating and rating text updated successfully" });
        } else {
          res.status(404).send({ message: "Join camp entry not found" });
        }
      } catch (error) {
        console.error("Error updating rating and rating text:", error);
        res.status(500).send({ error: error.message });
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
