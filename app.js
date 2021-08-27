// Setup Code

require("dotenv").config();
const express = require("express");
const bodyParser = require("body-parser");
const ejs = require("ejs");
const mongoose = require("mongoose");
const axios = require("axios");
const session = require("express-session");
const passport = require("passport");
const passportLocalMongoose = require("passport-local-mongoose");
const findOrCreate = require("mongoose-findorcreate");
const GoogleStrategy = require('passport-google-oauth20').Strategy;

const app = express();

app.set("view engine", "ejs");

app.use(express.static("public"));
app.use(bodyParser.urlencoded({extended: true}));

app.use(session({
  secret: process.env.SECRET,
  resave: false,
  saveUninitialized: false
}));

app.use(passport.initialize());
app.use(passport.session());

mongoose.set("useUnifiedTopology", true);
mongoose.set("useCreateIndex", true);
mongoose.set('useFindAndModify', false);
// mongoose.connect(process.env.MONGO_URL + "/SpeculationArenaDB", { useNewUrlParser: true });
mongoose.connect("mongodb://localhost:27017/SpeculationArenaDB", { useNewUrlParser: true });



//API Management

const priceAPI = process.env.NOMICS_API;

async function getPriceData(url) {
  try {
    const {data:response} = await axios.get(url)
    return response
  }
  catch (error) { console.log(error); }
}



// Mongoose Schemas/Models

const postSchema = new mongoose.Schema({
  user: String,
  post: String,
  votes: Number,
  date: String,
  upvotes: [{ type: String }],
  downvotes: [{ type: String }]
});

const Post = mongoose.model("Post", postSchema);

const userSchema = new mongoose.Schema({
  username: String,
  email: String,
  password: String,
  googleId: String
});

userSchema.plugin(passportLocalMongoose);
userSchema.plugin(findOrCreate);

const User = new mongoose.model("User", userSchema);



// Passport

passport.use(User.createStrategy());

passport.serializeUser(function(user, done) {
  done(null, user.id);
});

passport.deserializeUser(function(id, done) {
  User.findById(id, function(err, user) {
    done(err, user);
  });
});

passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    // callbackURL: "https://afternoon-headland-14782.herokuapp.com/auth/google/specarena",
    callbackURL: "http://localhost:3000/auth/google/specarena",
    userProfileURL: "https://www.googleapis.com/oauth2/v3/userinfo"
  },
  function(accessToken, refreshToken, profile, cb) {
    console.log(profile);

    User.findOrCreate({ username: profile.displayName, googleId: profile.id }, function (err, user) {
      return cb(err, user);
    });
  }
));



// Landing Page and Authentication

app.get("/", function(req, res) {
  if (req.isAuthenticated()) { res.redirect("/specarena"); }
  else { res.render("signup"); }
});

app.get('/auth/google',
  passport.authenticate('google', { scope: ['profile'] })
);

app.get("/auth/google/specarena",
  passport.authenticate("google", { failureRedirect: "/login" }),
  function(req, res) {
    // Successful authentication, redirect to specarena.
    res.redirect("/specarena");
  });



// Main Page

app.get("/specarena", function(req, res) {
  priceData = getPriceData(priceAPI);

  if (req.isAuthenticated()) {
    Post.find({}, function(err, foundPosts) { if (!err) {
      priceData.then(data => {
        res.render("specarena", {
          userDisplayName: req.user.username,
          logCheck: "Logout",
          logCheckLnk: "/logout",
          posts: foundPosts,
          btcprice: data[23].rate,
          ethprice: data[50].rate,
          comment: ""
        });
      });
    }});
  }

  else {
    Post.find({}, function(err, foundPosts) { if (!err) {
      priceData.then(data => {
        res.render("specarena", {
          userDisplayName: null,
          logCheck: "Login",
          logCheckLnk: "/login",
          posts: foundPosts,
          btcprice: data[23].rate,
          ethprice: data[50].rate,
          comment: "//"
        });
      });
    }});
  }

});



// Registration & Login/Logout

app.get("/register", function(req, res) {
  if (req.isAuthenticated()) { res.redirect("/specarena"); }
  else { res.render("register"); }
});

app.get("/login", function(req, res) {
  if (req.isAuthenticated()) { res.redirect("/specarena"); }
  else { res.render("login"); }
});

app.post("/register", function(req, res) {

  User.register({username: req.body.username}, req.body.password, function(err, user) {
    if (err) {
      console.log(err);
      res.redirect("/register");
    }
    else {
      passport.authenticate("local")(req, res, function() {
        res.redirect("specarena");
      });
    }
  });
});

app.post("/login", function(req, res) {

  const user = new User({
    username: req.body.username,
    password: req.body.password
  });

  req.login(user, function(err) {
    if (err) {
      console.log(err);
    }
    else {
      passport.authenticate("local")(req, res, function() {
        res.redirect("specarena");
      });
    }
  })
});

app.get("/logout", function(req, res) {
  req.logout();
  res.redirect("/");
});



// Submitting New Posts

app.post("/submit", function(req, res) {

  if (req.isAuthenticated()) {
  const post = new Post ({
    user: req.user.username,
    post: req.body.newpost,
    votes: 0,
    date: new Date().toISOString().split("T")[0]
  });

  console.log(post);

  post.save(function(err) {
    if (!err) { res.redirect("/specarena"); }
  }); }

  else { res.redirect("/login"); }
});



// Upvoting, Downvoting, and Deleting Posts

app.post("/upvote/:id", function(req, res) {

  if (req.isAuthenticated()) {
    Post.findOne({_id: req.params.id, upvotes: req.user.username}, function(err, found) {
      if (!err) {
       if (found) {
         Post.findOneAndUpdate(
           {_id: req.params.id},
           { $inc: { votes: -1 }, $pull: {upvotes: req.user.username}},
           function(err) { if (err) { console.log(err); }} );
         res.redirect("/specarena");
        }
        else {
          Post.findOneAndUpdate(
            {_id: req.params.id},
            { $inc: { votes: 1 }, $push: {upvotes: req.user.username}},
            function(err) { if (err) { console.log(err); }} );
          Post.findOneAndUpdate(
            {_id: req.params.id, downvotes: req.user.username},
            {$inc: { votes: 1 }, $pull: {downvotes: req.user.username}},
            function(err) { if (err) { console.log(err); }} );
          res.redirect("/specarena");
        }
    }});
  }

  else { res.redirect("/login"); }
});

app.post("/downvote/:id", function(req, res) {

  if (req.isAuthenticated()) {
    Post.findOne({_id: req.params.id, downvotes: req.user.username}, function(err, found) {
      if (!err) {
       if (found) {
         Post.findOneAndUpdate(
           {_id: req.params.id},
           { $inc: { votes: 1 }, $pull: {downvotes: req.user.username}},
           function(err) { if (err) { console.log(err); }} );
         res.redirect("/specarena");
        }
        else {
          Post.findOneAndUpdate(
            {_id: req.params.id},
            {$inc: { votes: -1 }, $push: {downvotes: req.user.username}},
            function(err) { if (err) { console.log(err); }} );
          Post.findOneAndUpdate(
            {_id: req.params.id, upvotes: req.user.username},
            {$inc: { votes: -1 }, $pull: {upvotes: req.user.username}},
            function(err) { if (err) { console.log(err); }} );
          res.redirect("/specarena");
        }
    }});
  }

  else { res.redirect("/login"); }
});

app.post("/delete/:id", function(req, res) {

  if (req.isAuthenticated()) {
    Post.findOneAndRemove({_id: req.params.id}, function(err) {
      if (err) { console.log(err); } });
    res.redirect("/specarena");
  }

  else { res.redirect("/login"); }
});



// Server Porting

let port = process.env.PORT;
if (port == null || port == "") {
  port = 3000;
}

app.listen(port, function() {
  console.log("Server started successfully");
});
