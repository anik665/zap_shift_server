const express = require("express");

const app = express();
require("dotenv").config();
const stripe = require("stripe")(process.env.DB_STRIPE_KEY);
const cors = require("cors");
const port = 3000;

const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

// middlewere
app.use(express.json());
app.use(cors());
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASSWORD}@cluster0.p8lzuaz.mongodb.net/?appName=Cluster0`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();
    const db = client.db("zap_shift_db");
    const parcelsCollections = db.collection("parcel");

    // parcels api

    app.post("/parcel", async (req, res) => {
      const parcel = req.body;
      parcel.createdAt = new Date();
      console.log(parcel, "parcel Data");
      const result = await parcelsCollections.insertOne(parcel);
      res.send(result);
    });
    app.get("/parcel", async (req, res) => {
      const email = req.query.email;
      console.log("1. Email:", email);
      const query = {};
      if (email) {
        query.senderEmail = email;
      }
      const option = { sort: { createdAt: -1 } };
      const cursor = await parcelsCollections.find(query, option).toArray();
      res.send(cursor);
    });
    // for payment status update

    app.get("/payment/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await parcelsCollections.findOne(query);
      res.send(result);
    });

    app.delete("/parcel/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await parcelsCollections.deleteOne(query);
      res.send(result);
    });

    //for payment intent

    app.post("/create-checkout-session", async (req, res) => {
      const { paymentInfo } = req.body;
      const amount = parseInt(paymentInfo.cost) * 100; // Convert to cents
      const session = await stripe.checkout.sessions.create({
        line_items: [
          {
            price_data: {
              currency: "usd",
              unit_amount: amount,

              product_data: {
                name: paymentInfo.parcelName,
              },
            },
            quantity: 1,
          },
        ],
        customer_email: paymentInfo.senderEmail,
        mode: "payment",
        metadata: {
          parcelId: paymentInfo.parcelId,
        },
        success_url: `${process.env.DB_SITE_URL}/dashbord/payment-success`,
        cancel_url: `${process.env.DB_SITE_URL}/dashboard/payment`,
      });
      console.log(session, "session");
      res.send({ url: session.url });
    });

    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!",
    );
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("zap shif shifting");
});

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});
