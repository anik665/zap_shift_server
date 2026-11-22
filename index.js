const express = require("express");

const app = express();
require("dotenv").config();
const stripe = require("stripe")(process.env.DB_STRIPE_KEY);
const cors = require("cors");
const port = 3000;

const crypto = require("crypto");
//firebase admin initialization
const { initializeApp, cert } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const serviceAccount = require("./zapship-3d7f9-firebase-adminsdk-fbsvc-32d39afb19.json");

initializeApp({
  credential: cert(serviceAccount),
});
const auth = getAuth();

const generateTrackingId = () => {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");

  const random = crypto.randomBytes(4).toString("hex").toUpperCase();

  return `ZS-${date}-${random}`;
};

const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const { format } = require("path");

// middlewere
app.use(express.json());
app.use(cors());

const verifyToken = async (req, res, next) => {
  const token = req.headers.authorization;
  // console.log("token", token);
  if (!token) {
    return res
      .status(401)
      .send({ success: false, message: "Unauthorized access" });
  }

  const idToken = token.split(" ")[1];
  try {
    const decoded = await auth.verifyIdToken(idToken);
    // console.log("decoded", decoded);
    req.decodeEmail = decoded.email;
    next();
  } catch (error) {
    return res
      .status(401)
      .send({ success: false, message: "Unauthorized access" });
  }
};

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
    // Connect the client to the server
    await client.connect();
    const db = client.db("zap_shift_db");
    const parcelsCollections = db.collection("parcel");
    const usersCollections = db.collection("users");
    const paymentsCollections = db.collection("payments");
    const riderCollections = db.collection("riders");
    const trackingCollections = db.collection("tracking");

    const verifyAdmin = async (req, res, next) => {
      const user = await usersCollections.findOne({ email: req.decodeEmail });
      if (!user || user.role !== "admin") {
        return res
          .status(403)
          .send({ success: false, message: "Forbidden access" });
      }
      next();
    };

    const verifyRider = async (req, res, next) => {
      const user = await usersCollections.findOne({ email: req.decodeEmail });
      if (!user || user.role !== "rider") {
        return res
          .status(403)
          .send({ success: false, message: "Forbidden access" });
      }
      next();
    };

    const trackingLog = async (trackingId, status) => {
      const log = {
        trackingId,
        status,
        deliveris: status.split("-").join(" "),
        createdAt: new Date(),
      };
      const result = await trackingCollections.insertOne(log);
      return result;
    };

    //user api

    app.post("/users", async (req, res) => {
      try {
        const user = req.body;
        const email = user.email;

        // 1. Check if the user already exists in the database
        const userExist = await usersCollections.findOne({ email });

        if (userExist) {
          return res.status(200).send({
            exists: true,
            message: "User already exists in the database.",
          });
        }

        // 2. Assign default role and account creation timestamp for new users
        user.role = "user";
        user.createdAt = new Date();

        // 3. Insert the new user document into the collection
        const result = await usersCollections.insertOne(user);

        // 4. Send success response back to the client
        res.status(201).send({
          exists: false,
          insertedId: result.insertedId,
          message: "User added successfully.",
        });
      } catch (error) {
        console.error("Database error while processing user:", error);
        res
          .status(500)
          .send({ success: false, message: "Internal Server Error" });
      }
    });

    // Get all users
    app.get("/users", verifyToken, async (req, res) => {
      try {
        const result = await usersCollections.find().toArray();
        res.status(200).send(result);
      } catch (error) {
        console.error("Database error while fetching users:", error);
        res
          .status(500)
          .send({ success: false, message: "Internal Server Error" });
      }
    });

    // Get role by email (useRole hook)
    app.get("/users/:email/role", verifyToken, async (req, res) => {
      try {
        const email = req.params.email;
        if (email !== req.decodeEmail) {
          return res
            .status(403)
            .send({ success: false, message: "Forbidden access" });
        }
        const user = await usersCollections.findOne({ email });
        res.send({ role: user?.role || "user" });
      } catch (error) {
        res
          .status(500)
          .send({ success: false, message: "Internal Server Error" });
      }
    });

    // Role update
    app.patch("/users/role/:id", verifyToken, verifyAdmin, async (req, res) => {
      try {
        const { role } = req.body;
        if (!["user", "rider", "admin"].includes(role)) {
          return res
            .status(400)
            .send({ success: false, message: "Invalid role" });
        }
        const result = await usersCollections.updateOne(
          { _id: new ObjectId(req.params.id) },
          { $set: { role } },
        );
        res.send(result); // modifiedCount frontend এ লাগবে
      } catch (error) {
        res
          .status(500)
          .send({ success: false, message: "Internal Server Error" });
      }
    });

    // Delete user
    app.delete("/users/:id", verifyToken, verifyAdmin, async (req, res) => {
      try {
        const result = await usersCollections.deleteOne({
          _id: new ObjectId(req.params.id),
        });
        res.send(result); // deletedCount frontend এ লাগবে
      } catch (error) {
        res
          .status(500)
          .send({ success: false, message: "Internal Server Error" });
      }
    });

    //Rider api
    app.post("/rider", async (req, res) => {
      const rider = req.body;
      rider.status = "pending";
      rider.createdAt = new Date().toLocaleString();
      const result = await riderCollections.insertOne(rider);
      res.send(result);
    });

    //Rider Gets api
    app.get("/rider", async (req, res) => {
      const query = {};

      if (req.query.status) {
        query.status = {
          $regex: `^${req.query.status.trim()}$`,
          $options: "i",
        };
      }

      if (req.query.district) {
        const escaped = req.query.district
          .trim()
          .replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        query.riderDistrict = {
          $regex: `^\\s*${escaped}\\s*$`,
          $options: "i",
        };
      }

      const option = { sort: { createdAt: -1 } };
      const cursor = await riderCollections.find(query, option).toArray();
      res.send(cursor);
    });

    //rider status update api

    app.patch("/rider/:id", verifyToken, async (req, res) => {
      const id = req.params.id;
      const status = req.body.status;
      const query = { _id: new ObjectId(id) };
      const updateDoc = {
        $set: {
          status: status,
        },
      };

      if (status === "approved") {
        const email = req.body.email;
        const useQuery = { email };
        const updateUser = { $set: { role: "rider" } };
        const userResult = await usersCollections.updateOne(
          useQuery,
          updateUser,
        );
      }

      const result = await riderCollections.updateOne(query, updateDoc);
      res.send(result);
    });

    // Rider actions: accept | reject | pickup | deliver
    app.patch(
      "/parcel/:id/rider-action",
      verifyToken,
      verifyRider,
      async (req, res) => {
        try {
          const { action, trackingId } = req.body;

          const flow = {
            accept: {
              from: "rider-assigned",
              update: {
                $set: {
                  deliveryStatus: "rider-accepted",
                  acceptedAt: new Date(),
                },
              },
            },
            reject: {
              from: "rider-assigned",
              update: {
                $unset: {
                  riderId: "",
                  riderName: "",
                  riderEmail: "",
                  assignedAt: "",
                  deliveryStatus: "",
                },
              },
            },
            pickup: {
              from: "rider-accepted",
              update: {
                $set: { deliveryStatus: "picked-up", pickedUpAt: new Date() },
              },
            },
            deliver: {
              from: "picked-up",
              update: {
                $set: { deliveryStatus: "delivered", deliveredAt: new Date() },
              },
            },
          };

          const step = flow[action];
          if (!step) {
            return res
              .status(400)
              .send({ success: false, message: "Invalid action" });
          }

          // শুধু নিজের parcel, আর সঠিক status order হলেই update হবে
          const result = await parcelsCollections.updateOne(
            {
              _id: new ObjectId(req.params.id),
              riderEmail: req.decodeEmail,
              deliveryStatus: step.from,
            },
            step.update,
          );

          if (
            result.modifiedCount > 0 &&
            (action === "reject" || action === "deliver")
          ) {
            await riderCollections.updateOne(
              { riderEmail: req.decodeEmail },
              { $set: { workStatus: "available" } },
            );
          }
          trackingLog(
            trackingId,
            (deliveryStatus = step.update.$set.deliveryStatus),
          );

          res.send(result);
        } catch (error) {
          res
            .status(500)
            .send({ success: false, message: "Internal Server Error" });
        }
      },
    );

    //RIder delivery starus per day stat
    app.get("/rider/delivery-status/per-day-stat", async (req, res) => {
      try {
        const email = req.query.email;
        const pipeline = [
          {
            $match: { riderEmail: email, deliveryStatus: "delivered" },
          },
          {
            $lookup: {
              from: "tracking",
              localField: "trackingId",
              foreignField: "trackingId",
              as: "parcel_traking",
            },
          },
          {
            $unwind: "$parcel_traking",
          },
          {
            $match: { "parcel_traking.status": "delivered" },
          },
          {
            $addFields: {
              deliveryday: {
                $dateToString: {
                  format: "%Y-%m-%d",
                  date: "$parcel_traking.createdAt",
                },
              },
            },
          },
          {
            $group: {
              _id: "$deliveryday",
              deliveryCount: { $sum: 1 },
            },
          },
        ];

        const result = await parcelsCollections.aggregate(pipeline).toArray();
        res.send(result);
      } catch (error) {
        res
          .status(500)
          .send({ success: false, message: "Internal Server Error" });
      }
    });

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

    // Paid parcels that have no rider yet (admin only)
    app.get(
      "/parcels/unassigned",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        try {
          const result = await parcelsCollections
            .find({ paymentStatus: "paid", riderEmail: { $exists: false } })
            .sort({ createdAt: -1 })
            .toArray();
          res.send(result);
        } catch (error) {
          res
            .status(500)
            .send({ success: false, message: "Internal Server Error" });
        }
      },
    );

    app.get("/parcel/rider", verifyToken, async (req, res) => {
      try {
        const { riderEmail, deliveryStatus } = req.query;

        if (riderEmail !== req.decodeEmail) {
          return res
            .status(403)
            .send({ success: false, message: "Forbidden access" });
        }

        const query = { riderEmail };
        if (deliveryStatus) {
          query.deliveryStatus = deliveryStatus;
        }

        const result = await parcelsCollections
          .find(query)
          .sort({ assignedAt: -1 })
          .toArray();
        res.send(result);
      } catch (error) {
        res
          .status(500)
          .send({ success: false, message: "Internal Server Error" });
      }
    });
    app.get("/parcel/delivery-status/stat", async (req, res) => {
      const pipeline = [
        {
          $group: {
            _id: "$deliveryStatus",
            count: { $sum: 1 },
          },
        },
        {
          $project: {
            status: "$_id",
            count: 1,
          },
        },
      ];
      const result = await parcelsCollections.aggregate(pipeline).toArray();
      res.send(result);
    });

    //tracking log api
    app.get("/tracking/:trackingId/log", async (req, res) => {
      const trackingId = req.params.trackingId;
      const result = await trackingCollections.find({ trackingId }).toArray();
      res.send(result);
    });

    // Assign rider to parcel (admin only)
    app.patch(
      "/parcel/:id/assign",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        try {
          const { riderId, riderName, riderEmail, trackingId } = req.body;
          if (!riderId || !riderEmail) {
            return res
              .status(400)
              .send({ success: false, message: "Rider info required" });
          }

          // riderEmail $exists: false দিলে একই parcel দুইবার assign হবে না
          const result = await parcelsCollections.updateOne(
            {
              _id: new ObjectId(req.params.id),
              riderEmail: { $exists: false },
            },
            {
              $set: {
                deliveryStatus: "rider-assigned",
                riderId,
                riderName,
                riderEmail,
                assignedAt: new Date(),
              },
            },
          );

          if (result.modifiedCount > 0) {
            await riderCollections.updateOne(
              { _id: new ObjectId(riderId) },
              { $set: { workStatus: "in-delivery" } },
            );
          }
          trackingLog(trackingId, (deliveryStatus = "rider-assigned"));

          res.send(result);
        } catch (error) {
          res
            .status(500)
            .send({ success: false, message: "Internal Server Error" });
        }
      },
    );

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

      // retrieve recipient info from parcel if not provided in paymentInfo
      let recipientName = paymentInfo.recipientName;
      let recipientPhone = paymentInfo.recipientPhone;
      let recipientAddress = paymentInfo.recipientAddress;

      if (!recipientName && paymentInfo.parcelId) {
        const parcelDoc = await parcelsCollections.findOne({
          _id: new ObjectId(paymentInfo.parcelId),
        });
        if (parcelDoc) {
          recipientName = parcelDoc.receiverName || parcelDoc.recipientName;
          recipientPhone = parcelDoc.receiverPhone || parcelDoc.recipientPhone;
          recipientAddress =
            parcelDoc.receiverAddress || parcelDoc.recipientAddress;
        }
      }

      const amount = parseInt(paymentInfo.cost) * 100; // Convert to paisa
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
          parcelName: paymentInfo.parcelName,
          recipientName: recipientName || "",
          recipientPhone: recipientPhone || "",
          recipientAddress: recipientAddress || "",
        },
        customer_email: paymentInfo.senderEmail,
        success_url: `${process.env.DB_SITE_URL}/dashbord/payment-success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.DB_SITE_URL}/dashbord/payment-cancel`,
      });

      res.send({ url: session.url });
    });

    // old one

    // app.post("/create-checkout-session", async (req, res) => {
    //   const { paymentInfo } = req.body;
    //   const amount = parseInt(paymentInfo.cost) * 100; // Convert to cents
    //   const session = await stripe.checkout.sessions.create({
    //     line_items: [
    //       {
    //         price_data: {
    //           currency: "bdt",
    //           unit_amount: amount,

    //           product_data: {
    //             name: paymentInfo.parcelName,
    //           },
    //         },
    //         quantity: 1,
    //       },
    //     ],
    //     customer_email: paymentInfo.senderEmail,
    //     mode: "payment",
    //     metadata: {
    //       parcelId: paymentInfo.parcelId,
    //       parcelName: paymentInfo.parcelName,
    //       recipientName: paymentInfo.recipientName,
    //       recipientPhone: paymentInfo.recipientPhone,
    //       recipientAddress: paymentInfo.recipientAddress,
    //     },
    //     success_url: `${process.env.DB_SITE_URL}/dashbord/payment-success`,
    //     cancel_url: `${process.env.DB_SITE_URL}/dashbord/payment-cancel`,
    //   });
    //   console.log(session, "session");
    //   res.send({ url: session.url });
    // });
    app.patch("/payment-success", async (req, res) => {
      const { session_id } = req.query;

      if (!session_id) {
        return res
          .status(400)
          .send({ success: false, message: "Session ID required" });
      }

      const session = await stripe.checkout.sessions.retrieve(session_id);

      if (session.payment_status === "paid") {
        const parcelId = session.metadata.parcelId;
        const query = { _id: new ObjectId(parcelId) };

        // ১. প্রথমে ডাটাবেজ থেকে পার্সেলটি খুঁজুন
        const existingParcel = await parcelsCollections.findOne(query);

        // ২. আগের ট্র্যাকিং আইডি থাকলে সেটি রাখুন, না থাকলে নতুন বানান
        const trackingId = existingParcel?.trackingId || generateTrackingId();

        const updateDoc = {
          $set: {
            paymentStatus: "paid",
            trackingId: trackingId,
            deliveryStatus: "pending",
          },
        };
        trackingLog(trackingId, (deliveryStatus = "pending"));
        const result = await parcelsCollections.updateOne(query, updateDoc);

        // ৩. পেমেন্ট রেকর্ড ইতিমধ্যেই তৈরি করা হয়েছে কিনা চেক করুন (Duplicate предотвратить করতে)
        const existingPayment = await paymentsCollections.findOne({
          transactionId: session.payment_intent,
        });

        if (!existingPayment) {
          const paymentData = {
            amount: session.amount_total / 100,
            currency: session.currency,
            transactionId: session.payment_intent,
            trackingId: trackingId,
            recipientName: session.metadata.recipientName,
            recipientPhone: session.metadata.recipientPhone,
            recipientAddress: session.metadata.recipientAddress,
            parcelId: session.metadata.parcelId,
            customerEmail: session.customer_email,
            paymentStatus: session.payment_status,
            paymentAt: new Date(),
            parcelName: session.metadata.parcelName,
          };
          await paymentsCollections.insertOne(paymentData);
        }

        return res.send({
          success: true,
          message: "Payment successful",
          trackingId: trackingId,
          transactionId: session.payment_intent,
        });
      }

      res.send({ success: false, message: "Payment failed" });
    });

    //payment history api
    app.get("/payment-history", verifyToken, async (req, res) => {
      const email = req.query.email;
      const query = { customerEmail: email };
      if (email !== req.decodeEmail) {
        return res
          .status(403)
          .send({ success: false, message: "Forbidden access" });
      }

      const cursor = paymentsCollections.find(query);
      const result = await cursor.toArray();
      // console.log(result, "payment history");
      res.send(result);
    });

    // app.get("/clean-duplicate-payments", async (req, res) => {
    //   try {
    //     // ১. ডুপ্লিকেট transactionId চিহ্নিত করা
    //     const duplicates = await paymentsCollections
    //       .aggregate([
    //         {
    //           $group: {
    //             _id: "$transactionId", // transactionId দিয়ে গ্রুপ করা
    //             count: { $sum: 1 },
    //             docs: { $push: "$_id" }, // সবগুলোর ObjectId লিস্টে রাখা
    //           },
    //         },
    //         {
    //           $match: {
    //             count: { $gt: 1 }, // একের অধিক থাকলে সেগুলাই ডুপ্লিকেট
    //           },
    //         },
    //       ])
    //       .toArray();

    //     let deletedCount = 0;

    //     // ২. প্রথমটি রেখে বাকিগুলো মুছে ফেলা
    //     for (const doc of duplicates) {
    //       const idsToDelete = doc.docs.slice(1); // Index 0 রেখে বাকিগুলো নেওয়া হলো
    //       const result = await paymentsCollections.deleteMany({
    //         _id: { $in: idsToDelete },
    //       });
    //       deletedCount += result.deletedCount;
    //     }

    //     res.send({
    //       success: true,
    //       message: `${deletedCount}টি ডুপ্লিকেট পেমেন্ট মুছে ফেলা হয়েছে।`,
    //     });
    //   } catch (error) {
    //     console.error(error);
    //     res.status(500).send({ success: false, message: error.message });
    //   }
    // });

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
