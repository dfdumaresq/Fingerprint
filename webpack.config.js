const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const webpack = require('webpack');
require('dotenv').config();

module.exports = {
  entry: "./src/index.tsx",
  output: {
    path: path.resolve(__dirname, "dist"),
    filename: "bundle.js",
  },
  resolve: {
    extensions: [".tsx", ".ts", ".js"],
  },
  module: {
    rules: [
      {
        test: /\.(ts|tsx)$/,
        exclude: /node_modules/,
        use: "ts-loader",
      },
      {
        test: /\.css$/,
        use: ["style-loader", "css-loader"],
      },
    ],
  },
  plugins: [
    new HtmlWebpackPlugin({
      template: "./public/index.html",
    }),
    new webpack.DefinePlugin({
      "process.env.REACT_APP_SEPOLIA_RPC_URL": JSON.stringify(
        process.env.REACT_APP_SEPOLIA_RPC_URL,
      ),
      "process.env.REACT_APP_SEPOLIA_CONTRACT_ADDRESS": JSON.stringify(
        process.env.REACT_APP_SEPOLIA_CONTRACT_ADDRESS,
      ),
      "process.env.REACT_APP_SEPOLIA_CHAIN_ID": JSON.stringify(
        process.env.REACT_APP_SEPOLIA_CHAIN_ID,
      ),
      "process.env.REACT_APP_API_GATEWAY_URL": JSON.stringify(
        process.env.REACT_APP_API_GATEWAY_URL || "http://localhost:3001",
      ),
    }),
  ],
  devServer: {
    static: {
      directory: path.join(__dirname, "public"),
    },
    port: 3000,
    hot: true,
  },
};
