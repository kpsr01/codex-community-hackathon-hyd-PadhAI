import './Sidebar.css'

function Sidebar({ chatHistory, onSelectChat }) {
  return (
    <div className="sidebar">
      <div className="sidebar-header">
        <h3>Chat History</h3>
      </div>
      
      <div className="chat-list">
        {chatHistory.length === 0 ? (
          <div className="empty-state">
            No previous chats
          </div>
        ) : (
          chatHistory.map((chat) => (
            <div 
              key={chat.id} 
              className="chat-item"
              onClick={() => onSelectChat(chat)}
            >
              <div className="chat-prompt">
                {chat.prompt.substring(0, 50)}...
              </div>
              <div className="chat-time">
                {chat.timestamp}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

export default Sidebar
