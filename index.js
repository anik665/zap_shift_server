const express = require("express");

const app = express();
require("dotenv").config();
const stripe = require("stripe")(process.env.DB_STRIPE_KEY);
const cors = require("cors");
const port = 3000;

const crypto = require("crypto");

const generateTrackingId = () => {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");

  const random = crypto.randomBytes(4).toString("hex").toUpperCase();

  return `ZS-${date}-${random}`;
};

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
    const paymentsCollections = db.collection("payments");

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

    app.post("/payment-cheakout-session", async (req, res) => {
      const { paymentInfo } = req.body;
      const amount = parseInt(paymentInfo.cost) * 100; //  Convert to paisa
      const session = await stripe.checkout.sessions.create({
        line_items: [
          {
            price_data: {
              currency: "bdt",
              unit_amount: amount,
              product_data: {
                name: paymentInfo.parcelName,
              },
            },
            quantity: 1,
          },
        ],
        mode: "payment",
        metadata: {
          parcelId: paymentInfo.parcelId,
        },
        customer_email: paymentInfo.senderEmail,
        // managed_payments: { enabled: true },
        success_url: `${process.env.DB_SITE_URL}/dashbord/payment-success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.DB_SITE_URL}/dashbord/payment-cancel`,
      });
      console.log("session isok  ", session);
      res.send({ url: session.url });
    });

    // old one

    app.post("/create-checkout-session", async (req, res) => {
      const { paymentInfo } = req.body;
      const amount = parseInt(paymentInfo.cost) * 100; // Convert to cents
      const session = await stripe.checkout.sessions.create({
        line_items: [
          {
            price_data: {
              currency: "bdt",
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
          parcelName: paymentInfo.parcelName,
        },
        success_url: `${process.env.DB_SITE_URL}/dashbord/payment-success`,
        cancel_url: `${process.env.DB_SITE_URL}/dashbord/payment-cancel`,
      });
      console.log(session, "session");
      res.send({ url: session.url });
    });
    app.patch("/payment-success", async (req, res) => {
      const session = await stripe.checkout.sessions.retrieve(
        req.query.session_id,
      );
      if (session.payment_status === "paid") {
        const parcelId = session.metadata.parcelId;
        const query = { _id: new ObjectId(parcelId) };
        const updateDoc = {
          $set: {
            paymentStatus: "paid",
            trackingId: generateTrackingId(),
          },
        };
        const result = await parcelsCollections.updateOne(query, updateDoc);

        const paymentData = {
          amount: session.amount_total / 100,
          currency: session.currency,
          transactionId: session.payment_intent,
          parcelId: session.metadata.parcelId,
          customerEmail: session.customer_email,
          paymentStatus: session.payment_status,
          paymentAt: new Date(),
          parcelName: session.metadata.parcelName,
        };
        if (session.payment_status === "paid") {
          const paymentResult =
            await paymentsCollections.insertOne(paymentData);
          res.send({
            success: true,
            message: "Payment successfull",
            result: paymentResult,
          });
        }

        // res.send({ success: true, message: "Payment successfull", result });
      }
      console.log("session", session);

      // Handle the successful payment logic here
      res.send({ success: false, message: "Payment failed" });
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
