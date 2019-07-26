import React, { Component } from 'react';
import { ActivityIndicator, View, Text, TouchableOpacity, Switch, FlatList, StyleSheet } from 'react-native';
import { GiftedChat } from 'react-native-gifted-chat';
import { ChatManager, TokenProvider } from '@pusher/chatkit-client';
import Config from 'react-native-config';
import axios from 'axios';
import Modal from 'react-native-modal';

const CHATKIT_INSTANCE_LOCATOR_ID = Config.CHATKIT_INSTANCE_LOCATOR_ID;
const CHATKIT_SECRET_KEY = Config.CHATKIT_SECRET_KEY;
const CHATKIT_TOKEN_PROVIDER_ENDPOINT = Config.CHATKIT_TOKEN_PROVIDER_ENDPOINT;
const CHAT_SERVER = 'YOUR NGROK HTTPS URL';

const ephemeral_settings = [
  {
    id: 1,
    name: 'expire_3_mins'
  },
  {
    id: 3,
    name: 'expire_tagged_has_read'
  }
];

function get_r_percent_last(arr, percent) {
  const count = arr.length * (percent / 100);
  return arr.slice(0, Math.round(count) + 1).pop();
}

class Chat extends Component {

  state = {
    messages: [],
    show_load_earlier: false,
    is_settings_modal_visible: false,
    expire_in: '',
    expire_3_mins: false,
    expire_tagged_has_read: false
  };


  static navigationOptions = ({ navigation }) => {
    const { params } = navigation.state;
    return {
      headerTitle: params.room_name,
      headerRight: (
        <View style={styles.header_right}>
          <TouchableOpacity style={styles.header_button_container} onPress={params.showSettingsModal}>
            <View>
              <Text style={styles.header_button_text}>Settings</Text>
            </View>
          </TouchableOpacity>
        </View>
      ),
      headerStyle: {
        backgroundColor: "#FFF"
      },
      headerTitleStyle: {
        color: "#333"
      }
    };
  };
  //

  constructor(props) {
    super(props);
    const { navigation } = this.props;

    this.user_id = navigation.getParam("user_id").toString();
    this.room_id = navigation.getParam("room_id");
  }


  componentWillUnMount() {
    this.currentUser.disconnect();
  }


  async componentDidMount() {
    this.props.navigation.setParams({
      showSettingsModal: this.showSettingsModal
    });

    try {
      const chatManager = new ChatManager({
        instanceLocator: CHATKIT_INSTANCE_LOCATOR_ID,
        userId: this.user_id,
        tokenProvider: new TokenProvider({ url: CHATKIT_TOKEN_PROVIDER_ENDPOINT })
      });

      let currentUser = await chatManager.connect({
        onRoomUpdated: this.onRoomUpdated
      });
      this.currentUser = currentUser;

      await this.currentUser.subscribeToRoomMultipart({
        roomId: this.room_id,
        hooks: {
          onMessage: this.onMessage,
          onMessageDeleted: this.onMessageDeleted
        },
        messageLimit: 30
      });

      const current_room = this.currentUser.rooms.find(room => room.id == this.room_id);
      const messages_expire_in = current_room.customData.messages_expire_in;

      await this.setState({
        [messages_expire_in]: true,
        expire_in: messages_expire_in
      });

    } catch (chat_mgr_err) {
      console.log("error with chat manager: ", chat_mgr_err);
    }
  }


  showSettingsModal = () => {
    this.setState({
      is_settings_modal_visible: true
    });
  }


  onRoomUpdated = (room) => {
    const expire_in = room.customData.messages_expire_in;
    const disabled_settings = ephemeral_settings.filter(item => item.name != expire_in).map(item => item.name);

    this.setState({
      [expire_in]: true,
      [disabled_settings[0]]: false,
    });
  }


  onMessage = (data) => {
    const { message } = this.getMessage(data);

    if (message.text != 'DELETED') {
      this.setState((previousState) => ({
        messages: GiftedChat.append(previousState.messages, message)
      }));
    }

    if (this.state.messages.length > 1) {
      this.setState({
        show_load_earlier: true
      });
    }
  }


  onMessageDeleted = (id) => {
    this.setState(state => {
      const messages = state.messages.filter((item) => {
        if (item._id != id) {
          return item;
        }
      });

      return {
        messages
      }
    });

  }


  getMessage = ({ id, sender, parts, createdAt }) => {
    const text = parts.find(part => part.partType === 'inline').payload.content;

    const msg_data = {
      _id: id,
      text: text,
      createdAt: new Date(createdAt),
      user: {
        _id: sender.id.toString(),
        name: sender.name,
        avatar: sender.avatarURL
      }
    };

    return {
      message: msg_data
    };
  }


  render() {
    const { messages, show_load_earlier, is_loading, is_settings_modal_visible } = this.state;
    return (
      <View style={styles.container}>
        {
          is_loading &&
          <ActivityIndicator size="small" color="#0000ff" />
        }
        <GiftedChat
          messages={messages}
          onSend={messages => this.onSend(messages)}
          showUserAvatar={true}
          user={{
            _id: this.user_id
          }}
          loadEarlier={show_load_earlier}
          onLoadEarlier={this.loadEarlierMessages}

          listViewProps={{
            scrollEventThrottle: 2000,
            onScroll: this.onScroll
          }}
        />

        <Modal isVisible={is_settings_modal_visible}>
          <View style={styles.modal}>
            <View style={styles.modal_header}>
              <Text style={styles.modal_header_text}>Settings</Text>
              <TouchableOpacity onPress={this.hideModal}>
                <View style={styles.close}>
                  <Text style={styles.close_text}>Close</Text>
                </View>
              </TouchableOpacity>
            </View>

            <View style={styles.modal_body}>
              <FlatList
                keyExtractor={(item, index) => item.id.toString()}
                data={ephemeral_settings}
                renderItem={this.renderSetting}
                extraData={this.state}
              />
            </View>
          </View>
        </Modal>
      </View>
    );
  }
  //

  onScroll = async ({ nativeEvent }) => {
    const percent = Math.round((nativeEvent.contentOffset.y / nativeEvent.contentSize.height) * 100);
    const last_message = get_r_percent_last(this.state.messages, percent);

    if (this.state.expire_in == 'expire_tagged_has_read') {
      const mentioned_user = last_message.text.match(/@[a-zA-Z0-9]+/g) || '';
      if (mentioned_user && mentioned_user[0].substr(1) == this.user_id) {
        await axios.post(`${CHAT_SERVER}/delete-message`, {
          room_id: this.room_id,
          message_id: last_message._id
        });

      }
    }
  }


  renderSetting = ({ item }) => {
    return (
      <View style={styles.setting_container}>
        <View style={styles.switch_container}>
          <Switch trackColor={"#ccc"} thumbColor={"#0fd00c"}
            value={this.state[item.name]}
            onValueChange={(value) => {
              this.changeEphemeralSetting(item.name, value);
            }}
          />
        </View>

        <View>
          <Text style={styles.setting_text}>{item.name.replace(/_/g, ' ')}</Text>
        </View>
      </View>
    );
  }
  //


  changeEphemeralSetting = async (name, value) => {
    if (value) {
      const disabled_settings = ephemeral_settings.filter(item => item.name != name).map(item => item.name);

      this.setState({
        [name]: value,
        [disabled_settings[0]]: false,
        expire_in: name
      });

      try {
        const res = await axios.post(`${CHAT_SERVER}/update-room`, {
          'room_id': this.room_id,
          'setting': name
        });
      } catch (err) {
        console.log('error: ', err);
      }
    }
  }


  hideModal = (type) => {
    this.setState({
      is_settings_modal_visible: false
    });
  }


  loadEarlierMessages = async () => {
    this.setState({
      is_loading: true
    });

    const earliest_message_id = Math.min(
      ...this.state.messages.map(m => parseInt(m._id))
    );

    try {
      let messages = await this.currentUser.fetchMultipartMessages({
        roomId: this.room_id,
        initialId: earliest_message_id,
        direction: "older",
        limit: 10
      });

      if (!messages.length) {
        this.setState({
          show_load_earlier: false
        });
      }

      let earlier_messages = [];
      messages.forEach((msg) => {
        let { message } = this.getMessage(msg);
        if (message.text != 'DELETED') {
          earlier_messages.push(message);
        }
      });

      await this.setState(previousState => ({
        messages: previousState.messages.concat(earlier_messages.reverse())
      }));
    } catch (err) {
      console.log("error occured while trying to load older messages", err);
    }

    await this.setState({
      is_loading: false
    });
  }
  //

  onSend = async ([message]) => {

    try {
      const message_parts = [
        { type: "text/plain", content: message.text }
      ];

      await this.currentUser.sendMultipartMessage({
        roomId: this.room_id,
        parts: message_parts
      });

    } catch (send_msg_err) {
      console.log("error sending message: ", send_msg_err);
    }
  }

}

const styles = StyleSheet.create({
  container: {
    flex: 1
  },

  modal: {
    flex: 1,
    backgroundColor: '#FFF'
  },
  close: {
    alignSelf: 'flex-end',
    marginBottom: 10
  },
  close_text: {
    color: '#565656'
  },
  modal_header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: 10
  },
  modal_header_text: {
    fontSize: 20,
    fontWeight: 'bold'
  },
  modal_body: {
    marginTop: 20,
    padding: 20
  },

  header_right: {
    flex: 1,
    flexDirection: "row",
    justifyContent: "space-around"
  },
  header_button_container: {
    marginRight: 10
  },
  header_button_text: {
    color: '#333'
  },

  setting_container: {
    flexDirection: 'row',
    marginBottom: 10
  },
  setting_text: {
    fontSize: 14
  },

  switch_container: {
    marginRight: 10
  }

});

export default Chat;